package com.radiflow.player;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy.LoadErrorInfo;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@UnstableApi
public class PlaybackService extends MediaSessionService {
    private static final String NETEASE_SCHEME = "radiflow-netease";
    private static final String NETEASE_PREFIX = "netease:";
    private static PlaybackFailure lastOnlineFailure;
    private static PlaybackAudioProcessor audioProcessor;
    private MediaSession session;

    static boolean isNetEase(String id) {
        return id != null && id.matches("netease:[0-9]{1,20}");
    }

    static PlaybackFailure playbackFailure(String id) {
        return lastOnlineFailure != null && lastOnlineFailure.id.equals(id) ? lastOnlineFailure : null;
    }

    static PlaybackAudioProcessor audioProcessor() {
        return audioProcessor;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory().setReadTimeoutMs(30_000);
        ResolvingDataSource.Factory sources = new ResolvingDataSource.Factory(
            new DefaultDataSource.Factory(this, http),
            request -> {
                if (!NETEASE_SCHEME.equals(request.uri.getScheme())) return request;
                EmbeddedNode node;
                try {
                    node = EmbeddedNode.get(this);
                } catch (IOException error) {
                    throw new OnlineServiceUnavailable(error);
                }
                // Every load, including a system-initiated next track, reaches the endpoint
                // that checks the full stream before opening the upstream audio.
                Map<String, String> headers = new HashMap<>(request.httpRequestHeaders);
                headers.put(EmbeddedNode.AUTH_HEADER, node.token);
                return request.buildUpon()
                    .setUri(node.streamUri(request.uri.getLastPathSegment()))
                    .setHttpRequestHeaders(headers)
                    .build();
            });
        DefaultMediaSourceFactory mediaSources = new DefaultMediaSourceFactory(sources)
            .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy() {
                @Override
                public long getRetryDelayMsFor(LoadErrorInfo info) {
                    if (info.exception instanceof OnlineServiceUnavailable) return C.TIME_UNSET;
                    if (info.exception instanceof InvalidResponseCodeException error && errorCode(error) != null) return C.TIME_UNSET;
                    return super.getRetryDelayMsFor(info);
                }
            });
        PlaybackAudioProcessor processor = new PlaybackAudioProcessor();
        audioProcessor = processor;
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this) {
            @Override
            protected AudioSink buildAudioSink(Context context, boolean enableFloatOutput, boolean playbackParameters) {
                return new DefaultAudioSink.Builder(context)
                    .setEnableAudioOutputPlaybackParameters(playbackParameters)
                    .setAudioProcessors(new AudioProcessor[] { processor })
                    .build();
            }
        };
        ExoPlayer player = new ExoPlayer.Builder(this, renderers)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .setMediaSourceFactory(mediaSources)
            .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                MediaItem item = player.getCurrentMediaItem();
                if (item != null && isNetEase(item.mediaId)) lastOnlineFailure = toFailure(item.mediaId, error);
            }

            @Override
            public void onPlayerErrorChanged(PlaybackException error) {
                if (error == null) lastOnlineFailure = null;
            }
        });
        Intent openPlayer = new Intent(this, MainActivity.class);
        PendingIntent activity = PendingIntent.getActivity(this, 0, openPlayer, PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this, player)
            .setSessionActivity(activity)
            .setCallback(new MediaSession.Callback() {
                @Override
                public ListenableFuture<List<MediaItem>> onAddMediaItems(
                    MediaSession session, MediaSession.ControllerInfo controller, List<MediaItem> items
                ) {
                    if (!getPackageName().equals(controller.getPackageName())) {
                        return Futures.immediateFailedFuture(new SecurityException("Only RadiFlow can edit the queue."));
                    }
                    List<MediaItem> playable = new ArrayList<>();
                    Map<String, JSONObject> library = null;
                    for (MediaItem item : items) {
                        Uri uri = Uri.parse(item.mediaId);
                        if (isNetEase(item.mediaId)) {
                            uri = new Uri.Builder().scheme(NETEASE_SCHEME).authority("song")
                                .appendPath(item.mediaId.substring(NETEASE_PREFIX.length())).build();
                        } else {
                            if (library == null) library = AndroidTrackLibrary.read(PlaybackService.this);
                            if (!library.containsKey(item.mediaId)) {
                                return Futures.immediateFailedFuture(new IllegalArgumentException("Unknown audio source."));
                            }
                        }
                        playable.add(item.buildUpon().setUri(uri).build());
                    }
                    return Futures.immediateFuture(playable);
                }
            })
            .build();
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onDestroy() {
        lastOnlineFailure = null;
        if (session != null) {
            session.getPlayer().release();
            session.release();
            session = null;
        }
        audioProcessor = null;
        super.onDestroy();
    }

    private static PlaybackFailure toFailure(String id, PlaybackException failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof OnlineServiceUnavailable) return new PlaybackFailure(id, "NETEASE_ANDROID_STARTUP", 0, 0);
            if (cause instanceof InvalidResponseCodeException response) {
                String code = errorCode(response);
                int retryAfter = 0;
                for (Map.Entry<String, List<String>> header : response.headerFields.entrySet()) {
                    if (!"retry-after".equalsIgnoreCase(header.getKey()) || header.getValue().isEmpty()) continue;
                    try {
                        retryAfter = Integer.parseInt(header.getValue().get(0));
                    } catch (NumberFormatException ignored) {}
                    break;
                }
                return new PlaybackFailure(id, code == null ? "NETEASE_STREAM_FAILED" : code, response.responseCode, retryAfter);
            }
        }
        String code = switch (failure.errorCode) {
            case PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ->
                "NETEASE_ANDROID_NETWORK";
            default -> failure.getErrorCodeName();
        };
        return new PlaybackFailure(id, code, 0, 0);
    }

    private static String errorCode(InvalidResponseCodeException response) {
        try {
            String code = new JSONObject(new String(response.responseBody, StandardCharsets.UTF_8)).optString("code");
            return code.startsWith("NETEASE_") ? code : null;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private static final class OnlineServiceUnavailable extends IOException {
        OnlineServiceUnavailable(IOException cause) {
            super(cause);
        }
    }

    record PlaybackFailure(String id, String code, int status, int retryAfter) {}
}
