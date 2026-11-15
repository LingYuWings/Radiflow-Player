package com.radiflow.player;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

@CapacitorPlugin(name = "RadiFlowPlayback")
public class RadiFlowPlaybackPlugin extends Plugin {
    private static final int MAX_QUEUE_SIZE = 5000;
    private final ExecutorService imports = Executors.newSingleThreadExecutor();
    private final ExecutorService searches = Executors.newFixedThreadPool(2);
    private ListenableFuture<MediaController> controller;
    private boolean followLibraryQueue;

    @Override
    public void load() {
        SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
        controller = new MediaController.Builder(getContext(), token).buildAsync();
        controller.addListener(() -> {
            try {
                controller.get().addListener(new Player.Listener() {
                    @Override
                    public void onEvents(Player player, Player.Events events) {
                        notifyListeners("playbackChanged", snapshot(player));
                    }
                });
            } catch (Exception ignored) {
                // Commands report connection failures to the renderer.
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    @Override
    protected void handleOnDestroy() {
        if (controller != null) MediaController.releaseFuture(controller);
        imports.shutdown();
        searches.shutdownNow();
    }

    @PluginMethod
    public void library(PluginCall call) {
        imports.execute(() -> {
            Map<String, JSONObject> tracks = AndroidTrackLibrary.read(getContext());
            if (AndroidTrackLibrary.refreshMetadata(getContext(), tracks)) AndroidTrackLibrary.save(getContext(), tracks);
            resolveLibrary(call, tracks);
        });
    }

    @PluginMethod
    public void importTracks(PluginCall call) {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("audio/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, picker, "onImport");
    }

    @ActivityCallback
    private void onImport(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            library(call);
            return;
        }

        List<Uri> selections = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) selections.add(clip.getItemAt(i).getUri());
        } else if (data.getData() != null) {
            selections.add(data.getData());
        }
        imports.execute(() -> {
            Map<String, JSONObject> tracks = AndroidTrackLibrary.read(getContext());
            List<MediaItem> added = new ArrayList<>();
            boolean readable = false;
            for (Uri uri : selections) {
                if (uri == null || !"content".equals(uri.getScheme())) continue;
                String id = uri.toString();
                try {
                    getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    JSONObject previous = tracks.get(id);
                    JSONObject track = AndroidTrackLibrary.readMetadata(getContext(), uri, previous);
                    tracks.put(id, track);
                    if (previous == null) added.add(toMediaItem(track));
                    readable = true;
                } catch (SecurityException ignored) {
                    // Providers without a persistent read grant cannot be re-opened later.
                }
            }
            if (!readable && !selections.isEmpty()) {
                call.reject("Android did not grant access to the selected audio files.", "IMPORT_PERMISSION");
                return;
            }
            if (!AndroidTrackLibrary.save(getContext(), tracks)) {
                call.reject("Could not save the local music library.", "IMPORT_SAVE");
                return;
            }
            if (!added.isEmpty()) appendToLibraryQueue(added);
            resolveLibrary(call, tracks);
        });
    }

    private void appendToLibraryQueue(List<MediaItem> added) {
        controller.addListener(() -> {
            try {
                MediaController player = controller.get();
                if (!followLibraryQueue || player.getCurrentMediaItem() == null) return;
                Set<String> queued = new HashSet<>();
                for (int i = 0; i < player.getMediaItemCount(); i++) queued.add(player.getMediaItemAt(i).mediaId);
                List<MediaItem> missing = new ArrayList<>();
                for (MediaItem item : added) if (!queued.contains(item.mediaId)) missing.add(item);
                if (!missing.isEmpty()) player.addMediaItems(missing);
            } catch (Exception ignored) {
                // The next legacy play request rebuilds the queue from the saved library.
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    @PluginMethod
    public void state(PluginCall call) {
        boolean includeQueue = call.getBoolean("includeQueue", true);
        withController(call, player -> call.resolve(snapshot(player, includeQueue)));
    }

    @PluginMethod
    public void playTrack(PluginCall call) {
        String id = call.getString("id");
        Map<String, JSONObject> tracks = AndroidTrackLibrary.read(getContext());
        if (!tracks.containsKey(id)) {
            call.reject("This track is no longer in the local library.", "TRACK_MISSING");
            return;
        }
        withController(call, player -> {
            followLibraryQueue = true;
            List<MediaItem> items = new ArrayList<>();
            int selectedIndex = 0;
            for (JSONObject track : tracks.values()) {
                if (id.equals(track.optString("id"))) selectedIndex = items.size();
                items.add(toMediaItem(track));
            }
            replaceQueue(call, player, items, selectedIndex, 0, true);
        });
    }

    @PluginMethod
    public void searchNetEase(PluginCall call) {
        String keywords = call.getString("keywords", "").trim();
        if (keywords.isEmpty() || keywords.length() > 200) {
            call.reject("Enter up to 200 characters to search NetEase.", "NETEASE_SEARCH_QUERY");
            return;
        }
        searches.execute(() -> {
            EmbeddedNode node;
            try {
                node = EmbeddedNode.get(getContext());
            } catch (java.io.IOException error) {
                call.reject("Could not start the embedded NetEase service.", "NETEASE_ANDROID_STARTUP");
                return;
            }
            try {
                JSONObject result = new JSONObject(node.search(keywords));
                JSONArray songs = result.getJSONArray("songs");
                Map<String, JSONObject> tracks = new LinkedHashMap<>();
                for (int index = 0; index < songs.length() && tracks.size() < 30; ++index) {
                    JSONObject song = songs.optJSONObject(index);
                    if (song == null) continue;
                    String id = song.optString("filename");
                    String title = song.optString("title");
                    if (PlaybackService.isNetEase(id) && !title.isEmpty()) {
                        tracks.putIfAbsent(id, onlineTrack(id, song));
                    }
                }
                resolveLibrary(call, tracks);
            } catch (Exception error) {
                call.reject("Could not search NetEase. Check your connection and try again.", "NETEASE_ANDROID_SEARCH");
            }
        });
    }

    @PluginMethod
    public void playNetEase(PluginCall call) {
        String id = call.getString("id");
        JSArray queue = call.getArray("queue");
        if (!PlaybackService.isNetEase(id) || queue == null || queue.length() > 30) {
            call.reject("Invalid NetEase queue.", "NETEASE_ANDROID_QUEUE");
            return;
        }
        playQueue(call, id, queue, true);
    }

    @PluginMethod
    public void playTracks(PluginCall call) {
        String id = call.getString("id");
        JSArray queue = call.getArray("queue");
        if (id == null || queue == null || queue.length() > MAX_QUEUE_SIZE) {
            call.reject("Invalid playback queue.", "PLAYBACK_QUEUE");
            return;
        }
        playQueue(call, id, queue, false);
    }

    private void playQueue(PluginCall call, String id, JSONArray queue, boolean onlineOnly) {
        List<MediaItem> items = new ArrayList<>();
        Set<String> queued = new HashSet<>();
        Map<String, JSONObject> library = onlineOnly ? Collections.emptyMap() : AndroidTrackLibrary.read(getContext());
        int selectedIndex = -1;
        for (int index = 0; index < queue.length(); ++index) {
            JSONObject track = resolveQueuedTrack(queue.optJSONObject(index), library);
            if (track == null) continue;
            String candidate = track.optString("id");
            if (!queued.add(candidate)) continue;
            if (id.equals(candidate)) selectedIndex = items.size();
            items.add(toMediaItem(track));
        }
        if (selectedIndex < 0) {
            call.reject("This track is no longer available in the requested queue.", "TRACK_MISSING");
            return;
        }
        int startIndex = selectedIndex;
        long startMillis = positionMillis(call.getDouble("position", 0.0));
        boolean autoplay = call.getBoolean("autoplay", true);
        withController(call, player -> {
            followLibraryQueue = false;
            replaceQueue(call, player, items, startIndex, startMillis, autoplay);
        });
    }

    @PluginMethod
    public void playQueuedTrack(PluginCall call) {
        String id = call.getString("id", "");
        withController(call, player -> {
            for (int index = 0; index < player.getMediaItemCount(); ++index) {
                if (!id.equals(player.getMediaItemAt(index).mediaId)) continue;
                player.seekTo(index, 0);
                if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                player.play();
                call.resolve(snapshot(player));
                return;
            }
            call.reject("This track is no longer in the queue.", "TRACK_MISSING");
        });
    }

    private static void replaceQueue(PluginCall call, MediaController player, List<MediaItem> items, int selectedIndex,
        long startMillis, boolean autoplay) {
        if (!autoplay) {
            player.pause();
            player.stop();
        }
        player.setMediaItems(items, selectedIndex, startMillis);
        if (autoplay) {
            player.prepare();
            player.play();
        }
        call.resolve(snapshot(player));
    }

    @PluginMethod
    public void editQueue(PluginCall call) {
        String action = call.getString("action", "");
        if ("enqueue".equals(action)) {
            JSONObject track = resolveQueuedTrack(call.getObject("track"), AndroidTrackLibrary.read(getContext()));
            if (track == null) {
                call.reject("This track is no longer available.", "TRACK_MISSING");
                return;
            }
            boolean next = call.getBoolean("next", false);
            withController(call, player -> {
                followLibraryQueue = false;
                enqueue(call, player, toMediaItem(track), next);
            });
            return;
        }
        int from = call.getInt("from", -1);
        int to = call.getInt("to", -1);
        withController(call, player -> {
            int count = player.getMediaItemCount();
            if ("clear".equals(action)) {
                player.pause();
                player.clearMediaItems();
            } else if ("remove".equals(action) && from >= 0 && from < count) {
                if (count == 1) player.pause();
                player.removeMediaItem(from);
            } else if ("move".equals(action) && from >= 0 && from < count && to >= 0 && to < count) {
                if (from != to) player.moveMediaItem(from, to);
            } else {
                call.reject("Invalid change to the playback queue.", "PLAYBACK_QUEUE");
                return;
            }
            followLibraryQueue = false;
            call.resolve(snapshot(player));
        });
    }

    private static void enqueue(PluginCall call, MediaController player, MediaItem track, boolean next) {
        int count = player.getMediaItemCount();
        int current = player.getCurrentMediaItemIndex();
        for (int i = 0; i < count; i++) {
            if (!track.mediaId.equals(player.getMediaItemAt(i).mediaId)) continue;
            if (next && i != current) {
                int destination = i < current ? current : current + 1;
                if (i != destination) player.moveMediaItem(i, destination);
            }
            call.resolve(snapshot(player));
            return;
        }
        if (count >= MAX_QUEUE_SIZE) {
            call.reject("The playback queue is full.", "PLAYBACK_QUEUE");
            return;
        }
        if (next && count > 0) player.addMediaItem(current + 1, track);
        else player.addMediaItem(track);
        call.resolve(snapshot(player));
    }

    @PluginMethod
    public void configurePlayback(PluginCall call) {
        Boolean shuffle = call.getBoolean("shuffle");
        String repeat = call.getString("repeat");
        Double volume = call.getDouble("volume");
        Boolean eqEnabled = call.getBoolean("eqEnabled");
        JSArray rawGains = call.getArray("eqGains");
        float[] eqGains = readEqualizerGains(rawGains);
        String visualizer = call.getString("visualizer");
        PlaybackAudioProcessor.VisualizerMode visualizerMode = switch (visualizer == null ? "" : visualizer) {
            case "off" -> PlaybackAudioProcessor.VisualizerMode.OFF;
            case "spectrum", "mirror" -> PlaybackAudioProcessor.VisualizerMode.SPECTRUM;
            case "waveform" -> PlaybackAudioProcessor.VisualizerMode.WAVEFORM;
            default -> null;
        };
        int repeatMode = switch (repeat == null ? "" : repeat) {
            case "off" -> Player.REPEAT_MODE_OFF;
            case "one" -> Player.REPEAT_MODE_ONE;
            case "all" -> Player.REPEAT_MODE_ALL;
            default -> -1;
        };
        if ((repeat != null && repeatMode < 0) || (volume != null && !Double.isFinite(volume))
            || (rawGains != null && eqGains == null) || (visualizer != null && visualizerMode == null)) {
            call.reject("Invalid playback settings.", "PLAYBACK_SETTINGS");
            return;
        }
        withController(call, player -> {
            PlaybackAudioProcessor audio = PlaybackService.audioProcessor();
            if (audio != null && (eqEnabled != null || eqGains != null || visualizerMode != null)) {
                audio.update(eqEnabled, eqGains, visualizerMode);
            }
            if (shuffle != null) player.setShuffleModeEnabled(shuffle);
            if (repeatMode >= 0) player.setRepeatMode(repeatMode);
            if (volume != null) player.setVolume((float) Math.max(0, Math.min(1, volume)));
            call.resolve(snapshot(player));
        });
    }

    private static float[] readEqualizerGains(JSONArray rawGains) {
        if (rawGains == null || rawGains.length() != PlaybackSignal.BAND_COUNT) return null;
        float[] gains = new float[PlaybackSignal.BAND_COUNT];
        for (int i = 0; i < gains.length; i++) {
            double gain = rawGains.optDouble(i);
            if (!Double.isFinite(gain)) return null;
            gains[i] = (float) Math.max(-12, Math.min(12, gain));
        }
        return gains;
    }

    @PluginMethod
    public void toggle(PluginCall call) {
        withController(call, player -> {
            if (player.getPlayWhenReady()) {
                player.pause();
            } else if (player.getCurrentMediaItem() != null) {
                if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                player.play();
            }
            call.resolve(snapshot(player));
        });
    }

    @PluginMethod
    public void skip(PluginCall call) {
        withController(call, player -> {
            if ("previous".equals(call.getString("direction")) && player.hasPreviousMediaItem()) {
                player.seekToPreviousMediaItem();
            } else if ("next".equals(call.getString("direction")) && player.hasNextMediaItem()) {
                player.seekToNextMediaItem();
            }
            if (player.getCurrentMediaItem() != null && player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
            call.resolve(snapshot(player));
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double seconds = call.getDouble("position", 0.0);
        withController(call, player -> {
            if (Double.isFinite(seconds)) player.seekTo(positionMillis(seconds));
            call.resolve(snapshot(player));
        });
    }

    private void withController(PluginCall call, Consumer<MediaController> action) {
        controller.addListener(() -> {
            try {
                action.accept(controller.get());
            } catch (Exception error) {
                call.reject("Could not communicate with Android playback.", "PLAYBACK_SERVICE", error);
            }
        }, ContextCompat.getMainExecutor(getContext()));
    }

    private void resolveLibrary(PluginCall call, Map<String, JSONObject> tracks) {
        call.resolve(new JSObject().put("tracks", new JSArray(new ArrayList<>(tracks.values()))));
    }

    private static long positionMillis(double seconds) {
        if (!Double.isFinite(seconds) || seconds < 0) return 0;
        return Math.round(seconds * 1000);
    }

    private static JSONObject resolveQueuedTrack(JSONObject requested, Map<String, JSONObject> library) {
        if (requested == null) return null;
        String id = requested.optString("id");
        return PlaybackService.isNetEase(id) ? onlineTrack(id, requested) : library.get(id);
    }

    private static String limitMetadata(String value, int length) {
        return value.length() <= length ? value : value.substring(0, length);
    }

    private static JSONObject onlineTrack(String id, JSONObject source) {
        JSObject track = new JSObject().put("id", id).put("title", limitMetadata(source.optString("title"), 512))
            .put("artist", limitMetadata(source.optString("artist"), 512));
        String album = limitMetadata(source.optString("album"), 512);
        if (!album.isEmpty()) track.put("album", album);
        String albumId = source.optString("albumId");
        if (albumId.matches("[0-9]{1,20}")) track.put("albumId", albumId);
        double duration = source.optDouble("duration");
        if (duration > 0 && Double.isFinite(duration)) track.put("duration", duration);
        String cover = source.optString("cover");
        if (!cover.isEmpty() && cover.length() <= 2048) {
            Uri artwork = Uri.parse(cover);
            String scheme = artwork.getScheme();
            String host = artwork.getHost();
            if (("http".equals(scheme) || "https".equals(scheme)) && host != null
                && (host.equals("music.126.net") || host.endsWith(".music.126.net"))
                && artwork.getUserInfo() == null && artwork.getPort() == -1) {
                track.put("cover", artwork.buildUpon().scheme("https").build().toString());
            }
        }
        return track;
    }

    private static MediaItem toMediaItem(JSONObject track) {
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .setTitle(track.optString("title")).setArtist(track.optString("artist"));
        String album = track.optString("album");
        if (!album.isEmpty()) metadata.setAlbumTitle(album);
        String albumId = track.optString("albumId");
        if (!albumId.isEmpty()) {
            Bundle extras = new Bundle(1);
            extras.putString("albumId", albumId);
            metadata.setExtras(extras);
        }
        String cover = track.optString("cover");
        if (!cover.isEmpty()) metadata.setArtworkUri(Uri.parse(cover));
        double duration = track.optDouble("duration");
        if (duration > 0 && Double.isFinite(duration)) metadata.setDurationMs(positionMillis(duration));
        return new MediaItem.Builder()
            .setMediaId(track.optString("id"))
            .setUri(track.optString("id"))
            .setMediaMetadata(metadata.build())
            .build();
    }

    private static JSObject toTrack(MediaItem item) {
        MediaMetadata metadata = item.mediaMetadata;
        JSObject track = new JSObject().put("id", item.mediaId)
            .put("title", metadata.title == null ? "" : metadata.title.toString())
            .put("artist", metadata.artist == null ? "" : metadata.artist.toString());
        if (metadata.albumTitle != null) track.put("album", metadata.albumTitle.toString());
        if (metadata.extras != null && metadata.extras.containsKey("albumId")) track.put("albumId", metadata.extras.getString("albumId"));
        if (metadata.artworkUri != null) track.put("cover", metadata.artworkUri.toString());
        if (metadata.durationMs != null) track.put("duration", metadata.durationMs / 1000.0);
        return track;
    }

    private static JSObject snapshot(Player player) {
        return snapshot(player, true);
    }

    private static JSObject snapshot(Player player, boolean includeQueue) {
        MediaItem item = player.getCurrentMediaItem();
        PlaybackException error = player.getPlayerError();
        long duration = player.getDuration();
        if (duration < 0 && item != null && item.mediaMetadata.durationMs != null) duration = item.mediaMetadata.durationMs;
        JSObject state = new JSObject()
            .put("trackId", item == null ? JSONObject.NULL : item.mediaId)
            .put("playing", player.isPlaying())
            .put("buffering", player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING)
            .put("position", Math.max(0, player.getCurrentPosition()) / 1000.0)
            .put("duration", Math.max(0, duration) / 1000.0)
            .put("hasPrevious", player.hasPreviousMediaItem())
            .put("hasNext", player.hasNextMediaItem())
            .put("shuffle", player.getShuffleModeEnabled())
            .put("repeat", switch (player.getRepeatMode()) {
                case Player.REPEAT_MODE_ONE -> "one";
                case Player.REPEAT_MODE_ALL -> "all";
                default -> "off";
            })
            .put("volume", player.getVolume());
        PlaybackAudioProcessor audio = PlaybackService.audioProcessor();
        if (audio != null) {
            PlaybackAudioProcessor.Settings settings = audio.settings();
            state.put("eqEnabled", settings.eqEnabled()).put("eqGains", toJsArray(settings.eqGains()));
            PlaybackAudioProcessor.VisualSample sample = player.isPlaying() ? audio.visualSample() : null;
            if (sample != null) {
                String key = sample.mode() == PlaybackAudioProcessor.VisualizerMode.SPECTRUM ? "visualizer" : "waveform";
                state.put(key, toJsArray(sample.values()));
            }
        }
        if (includeQueue) {
            JSArray queue = new JSArray();
            JSArray onlineQueue = new JSArray();
            boolean playingOnline = item != null && PlaybackService.isNetEase(item.mediaId);
            for (int index = 0; index < player.getMediaItemCount(); ++index) {
                MediaItem queued = player.getMediaItemAt(index);
                JSObject track = toTrack(queued);
                queue.put(track);
                if (playingOnline && PlaybackService.isNetEase(queued.mediaId)) onlineQueue.put(track);
            }
            state.put("queue", queue);
            if (playingOnline) state.put("onlineQueue", onlineQueue);
        }
        if (error != null) {
            PlaybackService.PlaybackFailure failure = item == null ? null : PlaybackService.playbackFailure(item.mediaId);
            JSObject detail = new JSObject().put("code", failure == null ? error.getErrorCodeName() : failure.code());
            if (failure != null) {
                if (failure.status() > 0) detail.put("httpStatus", failure.status());
                if (failure.retryAfter() > 0) detail.put("retryAfter", failure.retryAfter());
            }
            state.put("error", detail);
        }
        return state;
    }

    private static JSArray toJsArray(float[] values) {
        JSArray array = new JSArray();
        for (float value : values) array.put(Float.valueOf(value));
        return array;
    }
}
