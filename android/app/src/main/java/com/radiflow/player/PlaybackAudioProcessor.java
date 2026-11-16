package com.radiflow.player;

import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@UnstableApi
final class PlaybackAudioProcessor extends BaseAudioProcessor {
    enum VisualizerMode { OFF, SPECTRUM, WAVEFORM }

    record Settings(boolean eqEnabled, float[] eqGains, VisualizerMode visualizer) {}
    record VisualSample(VisualizerMode mode, float[] values) {}

    private volatile Settings settings = new Settings(false, new float[PlaybackSignal.BAND_COUNT], VisualizerMode.OFF);
    private volatile VisualSample visualSample;

    private Settings appliedSettings;
    private PlaybackSignal.Equalizer equalizer;
    private PlaybackSignal.Spectrum spectrum;
    // Sliding analysis window: the newest WINDOW_SIZE mono samples, analysed every `hop` frames (~60 Hz).
    private float[] window;
    private float[] ordered;
    private int windowPosition;
    private int windowFill;
    private int hop;
    private int sinceHop;

    // Analysis results stamped with media time. Decoding runs ahead of what is audible,
    // so readers pick the entry matching the current playback position instead of the newest.
    private static final int HISTORY = 240;
    private final Object historyLock = new Object();
    private final long[] historyTimes = new long[HISTORY];
    private final VisualSample[] historySamples = new VisualSample[HISTORY];
    private int historyHead;
    private int historyCount;
    private long streamBaseUs;
    private long framesSinceFlush;
    private long latencyUs = 300_000;

    Settings settings() {
        return settings;
    }

    void update(Boolean eqEnabled, float[] eqGains, VisualizerMode visualizer) {
        Settings previous = settings;
        settings = new Settings(eqEnabled == null ? previous.eqEnabled : eqEnabled,
            eqGains == null ? previous.eqGains : eqGains,
            visualizer == null ? previous.visualizer : visualizer);
        if (settings.visualizer != previous.visualizer) visualSample = null;
    }

    VisualSample visualSample() {
        VisualSample current = visualSample;
        return current != null && current.mode == settings.visualizer ? current : null;
    }

    /**
     * Sample that is audible at {@code positionUs} (player media position). If the stamps
     * drifted from the player clock (e.g. a gapless track change without a flush), the
     * history is re-based using the last measured decode-ahead latency.
     */
    VisualSample visualSample(long positionUs) {
        synchronized (historyLock) {
            if (historyCount == 0) return null;
            int newest = Math.floorMod(historyHead - 1, HISTORY);
            int oldest = Math.floorMod(historyHead - historyCount, HISTORY);
            if (positionUs > historyTimes[newest] + 250_000 || positionUs < historyTimes[oldest] - 250_000) {
                long shift = positionUs + latencyUs - historyTimes[newest];
                for (int i = 0; i < historyCount; i++) historyTimes[Math.floorMod(historyHead - 1 - i, HISTORY)] += shift;
                streamBaseUs += shift;
            }
            latencyUs = Math.max(0, Math.min(2_000_000, historyTimes[newest] - positionUs));
            VisualSample match = historySamples[oldest];
            for (int i = 0; i < historyCount; i++) {
                int index = Math.floorMod(historyHead - 1 - i, HISTORY);
                if (historyTimes[index] <= positionUs) { match = historySamples[index]; break; }
            }
            return match != null && match.mode == settings.visualizer ? match : null;
        }
    }

    @Override
    protected AudioFormat onConfigure(AudioFormat inputFormat) {
        return inputFormat.encoding == C.ENCODING_PCM_16BIT ? inputFormat : AudioFormat.NOT_SET;
    }

    @Override
    protected void onFlush(StreamMetadata streamMetadata) {
        appliedSettings = null;
        equalizer = null;
        spectrum = null;
        window = null;
        visualSample = null;
        synchronized (historyLock) {
            historyCount = 0;
            historyHead = 0;
            streamBaseUs = streamMetadata.positionOffsetUs;
            framesSinceFlush = 0;
        }
    }

    private void applySettings(Settings current) {
        if (appliedSettings == current) return;
        if (appliedSettings == null || current.eqEnabled != appliedSettings.eqEnabled
            || current.eqGains != appliedSettings.eqGains) {
            equalizer = current.eqEnabled
                ? new PlaybackSignal.Equalizer(inputAudioFormat.sampleRate, inputAudioFormat.channelCount, current.eqGains)
                : null;
        }
        if (appliedSettings == null || current.visualizer != appliedSettings.visualizer) {
            spectrum = current.visualizer == VisualizerMode.SPECTRUM
                ? new PlaybackSignal.Spectrum(inputAudioFormat.sampleRate) : null;
            window = current.visualizer == VisualizerMode.OFF ? null : new float[PlaybackSignal.WINDOW_SIZE];
            ordered = window == null ? null : new float[PlaybackSignal.WINDOW_SIZE];
            windowPosition = 0;
            windowFill = 0;
            hop = Math.max(256, inputAudioFormat.sampleRate / 60);
            sinceHop = 0;
        }
        appliedSettings = current;
    }

    @Override
    public void queueInput(ByteBuffer input) {
        // Media3 uses the same empty buffer sentinel for an empty pipeline input and output.
        if (!input.hasRemaining()) return;
        Settings current = settings;
        applySettings(current);
        ByteBuffer output = replaceOutputBuffer(input.remaining());
        boolean filter = equalizer != null && !equalizer.isFlat();
        if (!filter && current.visualizer == VisualizerMode.OFF) {
            framesSinceFlush += input.remaining() / Math.max(1, inputAudioFormat.bytesPerFrame);
            output.put(input);
        } else {
            input.order(ByteOrder.nativeOrder());
            output.order(ByteOrder.nativeOrder());
            int channels = inputAudioFormat.channelCount;
            while (input.remaining() >= inputAudioFormat.bytesPerFrame) {
                int mono = 0;
                for (int channel = 0; channel < channels; channel++) {
                    short sample = input.getShort();
                    if (filter) {
                        long value = Math.round(equalizer.process(sample, channel));
                        sample = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, value));
                    }
                    output.putShort(sample);
                    mono += sample;
                }
                framesSinceFlush++;
                if (window != null) analyzeSample(current.visualizer, mono / (channels * 32768f));
            }
            output.put(input);
        }
        output.flip();
    }

    private void analyzeSample(VisualizerMode mode, float mono) {
        window[windowPosition] = mono;
        windowPosition = (windowPosition + 1) % window.length;
        if (windowFill < window.length) windowFill++;
        if (++sinceHop < hop || windowFill < window.length) return;
        sinceHop = 0;
        // Oldest-to-newest copy of the circular window.
        int tail = window.length - windowPosition;
        System.arraycopy(window, windowPosition, ordered, 0, tail);
        System.arraycopy(window, 0, ordered, tail, windowPosition);
        float[] values;
        if (mode == VisualizerMode.SPECTRUM) {
            values = spectrum.analyze(ordered);
        } else {
            values = new float[96];
            int span = ordered.length / 2;
            int start = ordered.length - span;
            for (int i = 0; i < values.length; i++) values[i] = ordered[start + i * span / values.length];
        }
        VisualSample sample = new VisualSample(mode, values);
        visualSample = sample;
        long timeUs = framesSinceFlush * 1_000_000L / Math.max(1, inputAudioFormat.sampleRate);
        synchronized (historyLock) {
            historyTimes[historyHead] = streamBaseUs + timeUs;
            historySamples[historyHead] = sample;
            historyHead = (historyHead + 1) % HISTORY;
            historyCount = Math.min(HISTORY, historyCount + 1);
        }
    }
}
