package com.radiflow.player;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "AndroidNetEase")
public class AndroidNetEasePlugin extends Plugin {
    private static final Pattern READ_ENDPOINT = Pattern.compile(
        "/api/netease/(?:session|playlists|login/qr/check|search(?:/(?:default|hot(?:/detail)?|suggest|multimatch))?"
            + "|lyric|(?:album|artist|playlist|lyric)/[0-9]+)"
    );
    private static final Pattern POST_ENDPOINT = Pattern.compile(
        "/api/netease/(?:logout|login/qr/start|playlists(?:/[0-9]+/tracks)?)"
    );
    private static final Pattern DELETE_ENDPOINT = Pattern.compile("/api/netease/playlists/[0-9]+");
    private final ExecutorService requests = Executors.newFixedThreadPool(4);

    @Override
    protected void handleOnDestroy() {
        requests.shutdownNow();
    }

    @PluginMethod
    public void request(PluginCall call) {
        String target = call.getString("path");
        String method = call.getData().has("method") ? call.getString("method") : "GET";
        JSObject payload = call.getObject("body");
        byte[] body = payload == null ? null : payload.toString().getBytes(StandardCharsets.UTF_8);
        boolean invalidBody = call.getData().has("body") && (body == null || !"POST".equals(method) || body.length > 96 * 1024);
        if (!isAllowed(target, method) || invalidBody) {
            call.reject("Invalid NetEase request.", "NETEASE_ANDROID_REQUEST");
            return;
        }

        requests.execute(() -> {
            EmbeddedNode node;
            try {
                node = EmbeddedNode.get(getContext());
            } catch (IOException error) {
                call.reject("Could not start the embedded NetEase service.", "NETEASE_ANDROID_STARTUP");
                return;
            }
            try {
                EmbeddedNode.Response response = node.request(target, method, body);
                int status = response.status();
                JSObject data;
                try {
                    data = new JSObject(response.body());
                } catch (JSONException error) {
                    if (status >= 200 && status < 300) throw new IOException("Invalid NetEase response.");
                    data = new JSObject().put("error", "NetEase request failed (HTTP " + status + ").");
                }
                call.resolve(new JSObject().put("status", status).put("data", data));
            } catch (IOException error) {
                call.reject("Could not complete the NetEase request.", "NETEASE_ANDROID_CONNECTION");
            }
        });
    }

    private static boolean isAllowed(String target, String method) {
        if (target == null || target.length() > 4096 || method == null) return false;
        try {
            URI uri = new URI(target);
            if (uri.getScheme() != null || uri.getRawAuthority() != null || uri.getRawFragment() != null) return false;
            String path = uri.getRawPath();
            if (path == null) return false;
            return switch (method) {
                case "GET" -> READ_ENDPOINT.matcher(path).matches();
                case "POST" -> POST_ENDPOINT.matcher(path).matches();
                case "DELETE" -> DELETE_ENDPOINT.matcher(path).matches();
                default -> false;
            };
        } catch (URISyntaxException error) {
            return false;
        }
    }
}
