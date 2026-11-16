package com.radiflow.player;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.AtomicFile;

import androidx.core.content.FileProvider;


import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashMap;
import java.util.Map;

final class AndroidTrackLibrary {
    private static final String TRACKS = "tracks";
    private static final String METADATA_VERSION = "metadataVersion";
    private static final int CURRENT_METADATA_VERSION = 1;
    private static final int ARTWORK_SIZE = 512;
    private static final int MAX_ARTWORK_BYTES = 16 * 1024 * 1024;

    private AndroidTrackLibrary() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("radiflow-android-library", Context.MODE_PRIVATE);
    }

    static Map<String, JSONObject> read(Context context) {
        Map<String, JSONObject> tracks = new LinkedHashMap<>();
        try {
            JSONArray entries = new JSONArray(preferences(context).getString(TRACKS, "[]"));
            for (int i = 0; i < entries.length(); i++) {
                JSONObject track = entries.optJSONObject(i);
                if (track == null) continue;
                String id = track.optString("id");
                Uri uri = Uri.parse(id);
                if ("content".equals(uri.getScheme()) && uri.getAuthority() != null) tracks.put(id, track);
            }
        } catch (JSONException ignored) {
            // An unreadable library can be re-imported.
        }
        return tracks;
    }

    static boolean save(Context context, Map<String, JSONObject> tracks) {
        return preferences(context).edit().putString(TRACKS, new JSONArray(tracks.values()).toString()).commit();
    }

    static boolean refreshMetadata(Context context, Map<String, JSONObject> tracks) {
        boolean updated = false;
        for (Map.Entry<String, JSONObject> entry : tracks.entrySet()) {
            JSONObject track = entry.getValue();
            boolean missingArtwork = track.has("cover") && !artworkFile(context, entry.getKey()).isFile();
            if (track.optInt(METADATA_VERSION) == CURRENT_METADATA_VERSION && !missingArtwork) continue;
            entry.setValue(readMetadata(context, Uri.parse(entry.getKey()), track));
            updated = true;
        }
        return updated;
    }

    static JSONObject readMetadata(Context context, Uri uri, JSONObject fallback) {
        String id = uri.toString();
        String title = fallback == null ? displayName(context, uri) : fallback.optString("title", "Audio");
        LibraryJson result = new LibraryJson().put("id", id).put("title", title)
            .put("artist", fallback == null ? "" : fallback.optString("artist"))
            .put(METADATA_VERSION, CURRENT_METADATA_VERSION);
        if (fallback != null) {
            if (fallback.has("album")) result.put("album", fallback.optString("album"));
            if (fallback.has("duration")) result.put("duration", fallback.optDouble("duration"));
        }
        File artwork = artworkFile(context, id);
        MediaMetadataRetriever metadata = new MediaMetadataRetriever();
        try {
            metadata.setDataSource(context, uri);
            String titleTag = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            if (titleTag != null && !titleTag.trim().isEmpty()) result.put("title", titleTag);
            String artistTag = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            if (artistTag != null) result.put("artist", artistTag);
            String albumTag = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            if (albumTag != null && !albumTag.trim().isEmpty()) result.put("album", albumTag);
            String durationTag = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (durationTag != null) {
                try {
                    long millis = Long.parseLong(durationTag);
                    if (millis > 0) result.put("duration", millis / 1000.0);
                } catch (NumberFormatException ignored) {}
            }
            if (!artwork.isFile()) cacheArtwork(artwork, metadata.getEmbeddedPicture());
        } catch (RuntimeException ignored) {
            // A file can still play without readable tags.
        } finally {
            try { metadata.release(); } catch (Exception ignored) {}
        }
        if (artwork.isFile()) {
            result.put("cover", FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", artwork).toString());
        }
        return result;
    }

    private static String displayName(Context context, Uri uri) {
        try (Cursor cursor = context.getContentResolver().query(uri,
            new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (RuntimeException ignored) {
            // Some document providers do not expose display names.
        }
        return "Audio";
    }

    private static File artworkFile(Context context, String id) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte value : hash) {
                hex.append(Character.forDigit((value >> 4) & 0xf, 16));
                hex.append(Character.forDigit(value & 0xf, 16));
            }
            return new File(new File(context.getCacheDir(), "radiflow-track-art"), hex + ".jpg");
        } catch (NoSuchAlgorithmException impossible) {
            throw new AssertionError(impossible);
        }
    }

    private static void cacheArtwork(File target, byte[] picture) {
        if (picture == null || picture.length == 0 || picture.length > MAX_ARTWORK_BYTES) return;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(picture, 0, picture.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0) return;
        int longestSide = Math.max(options.outWidth, options.outHeight);
        options.inSampleSize = 1;
        while (longestSide / options.inSampleSize > ARTWORK_SIZE) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        Bitmap bitmap = BitmapFactory.decodeByteArray(picture, 0, picture.length, options);
        if (bitmap == null) return;
        AtomicFile file = new AtomicFile(target);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            if (bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output)) file.finishWrite(output);
            else file.failWrite(output);
        } catch (IOException ignored) {
            file.failWrite(output);
        } finally {
            bitmap.recycle();
        }
    }
}
