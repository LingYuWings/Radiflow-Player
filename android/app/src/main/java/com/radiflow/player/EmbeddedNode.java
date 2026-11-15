package com.radiflow.player;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.SystemClock;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

final class EmbeddedNode {
    static final String AUTH_HEADER = "X-RadiFlow-Token";
    record Response(int status, String body) {}

    private static FutureTask<EmbeddedNode> startup;

    final String token;
    private final int port;
    private final AtomicBoolean stopped;

    private EmbeddedNode(int port, String token, AtomicBoolean stopped) {
        this.port = port;
        this.token = token;
        this.stopped = stopped;
    }

    static EmbeddedNode get(Context context) throws IOException {
        FutureTask<EmbeddedNode> task;
        synchronized (EmbeddedNode.class) {
            if (startup == null) {
                Context app = context.getApplicationContext();
                startup = new FutureTask<>(() -> start(app));
                new Thread(startup, "RadiFlow Node startup").start();
            }
            task = startup;
        }
        try {
            EmbeddedNode endpoint = task.get();
            if (endpoint.stopped.get()) throw new IOException("The embedded NetEase service stopped.");
            return endpoint;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("NetEase startup was interrupted.", error);
        } catch (ExecutionException error) {
            Log.w("RadiFlowNode", "Embedded service startup failed", error.getCause());
            throw new IOException("The embedded NetEase service could not start.", error.getCause());
        }
    }

    Uri streamUri(String id) {
        return Uri.parse(baseUrl() + "/api/netease/song/stream/" + id);
    }

    String search(String keywords) throws IOException {
        String path = Uri.parse("/api/netease/search").buildUpon()
            .appendQueryParameter("keywords", keywords)
            .build().toString();
        Response response = request(path, "GET", null, 15_000, 512 * 1024);
        if (response.status() != 200) throw new IOException("NetEase search failed.");
        return response.body();
    }

    Response request(String path, String method, byte[] body) throws IOException {
        int readTimeout = path.startsWith("/api/netease/artist/") ? 120_000 : 45_000;
        return request(path, method, body, readTimeout, 8 * 1024 * 1024);
    }

    private Response request(String path, String method, byte[] body, int readTimeout, int limit) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl() + path).openConnection(Proxy.NO_PROXY);
        try {
            connection.setRequestMethod(method);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(readTimeout);
            connection.setRequestProperty(AUTH_HEADER, token);
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
            }
            int status = connection.getResponseCode();
            try (InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream()) {
                return new Response(status, input == null ? "" : readText(input, limit));
            }
        } finally {
            connection.disconnect();
        }
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    private static EmbeddedNode start(Context context) throws Exception {
        File root = new File(context.getNoBackupFilesDir(), "radiflow-node");
        File project = new File(root, "project");
        long version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).lastUpdateTime;
        File ready = new File(project, ".ready-" + version);
        if (!ready.isFile()) {
            removeTree(project);
            extractProject(context, project);
            if (!ready.createNewFile()) throw new IOException("Could not mark the Node project ready.");
        }
        File data = new File(root, "data");
        ensureDirectory(data);
        File portFile = new File(data, "server.port");
        if (portFile.exists() && !portFile.delete()) throw new IOException("Could not reset the Node port file.");
        String token = UUID.randomUUID().toString();
        boolean debug = (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        String previewCookiePath = debug ? new File(root, "preview-cookie").getAbsolutePath() : "";
        String[] args = {
            "/proc/self/exe", new File(project, "bootstrap.mjs").getAbsolutePath(), data.getAbsolutePath(),
            token, previewCookiePath,
        };
        System.loadLibrary("radiflow_node");
        AtomicBoolean stopped = new AtomicBoolean();
        new Thread(() -> {
            try {
                int exitCode = runNode(args);
                Log.w("RadiFlowNode", "Node runtime exited with code " + exitCode);
            } finally {
                stopped.set(true);
            }
        }, "RadiFlow Node runtime").start();
        long deadline = SystemClock.elapsedRealtime() + 12_000;
        while (!stopped.get() && SystemClock.elapsedRealtime() < deadline) {
            if (portFile.isFile()) {
                try (InputStream input = new FileInputStream(portFile)) {
                    String port = readText(input, 128);
                    if (!port.matches("[1-9][0-9]{0,4}")) throw new IOException("Node bootstrap status: " + port);
                    return new EmbeddedNode(Integer.parseInt(port), token, stopped);
                }
            }
            Thread.sleep(40);
        }
        throw new IOException("Node did not start its local HTTP service.");
    }

    private static native int runNode(String[] arguments);

    private static void extractProject(Context context, File root) throws IOException {
        ensureDirectory(root);
        String prefix = root.getCanonicalPath() + File.separator;
        try (ZipInputStream zip = new ZipInputStream(context.getAssets().open("radiflow-node.zip"))) {
            ZipEntry entry;
            byte[] buffer = new byte[32_768];
            while ((entry = zip.getNextEntry()) != null) {
                File destination = new File(root, entry.getName()).getCanonicalFile();
                if (!destination.getPath().startsWith(prefix)) throw new IOException("Invalid bundled Node asset.");
                if (entry.isDirectory()) {
                    ensureDirectory(destination);
                } else {
                    ensureDirectory(destination.getParentFile());
                    try (FileOutputStream output = new FileOutputStream(destination)) {
                        int count;
                        while ((count = zip.read(buffer)) != -1) output.write(buffer, 0, count);
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private static void ensureDirectory(File directory) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Could not prepare the Node directory.");
    }

    private static void removeTree(File file) throws IOException {
        if (!file.exists()) return;
        File[] entries = file.listFiles();
        if (entries != null) {
            for (File entry : entries) removeTree(entry);
        }
        if (!file.delete()) throw new IOException("Could not refresh the embedded Node project.");
    }

    private static String readText(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > limit) throw new IOException("The NetEase response was too large.");
            output.write(buffer, 0, count);
        }
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }
}
