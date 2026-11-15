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
    private float[] window;
    private int frameCount;
    private int framesToSkip;

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
        frameCount = 0;
        framesToSkip = 0;
        visualSample = null;
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
            frameCount = 0;
            framesToSkip = 0;
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
                if (window != null) analyzeSample(current.visualizer, mono / (channels * 32768f));
            }
            output.put(input);
        }
        output.flip();
    }

    private void analyzeSample(VisualizerMode mode, float mono) {
        if (framesToSkip > 0) {
            framesToSkip--;
            return;
        }
        window[frameCount++] = mono;
        if (frameCount < window.length) return;
        float[] values;
        if (mode == VisualizerMode.SPECTRUM) {
            values = spectrum.analyze(window);
        } else {
            values = new float[64];
            for (int i = 0; i < values.length; i++) values[i] = window[i * window.length / values.length];
        }
        visualSample = new VisualSample(mode, values);
        frameCount = 0;
        framesToSkip = Math.max(0, inputAudioFormat.sampleRate / 15 - window.length);
    }
}
