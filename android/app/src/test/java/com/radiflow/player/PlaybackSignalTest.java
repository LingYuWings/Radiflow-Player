package com.radiflow.player;

import androidx.media3.common.audio.AudioProcessor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlaybackSignalTest {
    @Test
    public void acceptsEmptyMedia3Input() {
        PlaybackAudioProcessor processor = new PlaybackAudioProcessor();
        processor.queueInput(AudioProcessor.EMPTY_BUFFER);
        assertEquals(0, processor.getOutput().remaining());
    }
    private static final int SAMPLE_RATE = 48_000;

    @Test
    public void adjustsTargetFrequencyWithoutLeakingBetweenStereoChannels() {
        float[] gains = new float[10];
        gains[5] = 6;
        PlaybackSignal.Equalizer boost = new PlaybackSignal.Equalizer(SAMPLE_RATE, 2, gains);
        gains[5] = -6;
        PlaybackSignal.Equalizer cut = new PlaybackSignal.Equalizer(SAMPLE_RATE, 2, gains);
        double inputEnergy = 0;
        double boostEnergy = 0;
        double cutEnergy = 0;
        for (int frame = 0; frame < 4096; frame++) {
            double input = 4000 * Math.sin(2 * Math.PI * 1000 * frame / SAMPLE_RATE);
            double boosted = boost.process(input, 0);
            double reduced = cut.process(input, 0);
            assertEquals(0, boost.process(0, 1), 1e-12);
            if (frame < 512) continue;
            inputEnergy += input * input;
            boostEnergy += boosted * boosted;
            cutEnergy += reduced * reduced;
        }
        assertEquals(6, 10 * Math.log10(boostEnergy / inputEnergy), 0.1);
        assertEquals(-6, 10 * Math.log10(cutEnergy / inputEnergy), 0.1);
    }

    @Test
    public void spectrumFindsToneAndKeepsSilenceAtZero() {
        float[] samples = new float[PlaybackSignal.WINDOW_SIZE];
        PlaybackSignal.Spectrum spectrum = new PlaybackSignal.Spectrum(SAMPLE_RATE);
        for (float level : spectrum.analyze(samples)) assertEquals(0, level, 0);
        for (int i = 0; i < samples.length; i++) {
            samples[i] = (float) (0.45 * Math.sin(2 * Math.PI * 1000 * i / SAMPLE_RATE));
        }
        float[] levels = spectrum.analyze(samples);
        int strongest = 0;
        for (int i = 1; i < levels.length; i++) if (levels[i] > levels[strongest]) strongest = i;
        assertEquals(16, levels.length);
        assertEquals(8, strongest);
        assertTrue(levels[strongest] > 0.8f);
        assertTrue(levels[15] < 0.1f);
    }
}
