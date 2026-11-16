package com.radiflow.player;

import java.util.ArrayList;
import java.util.List;

final class PlaybackSignal {
    static final int WINDOW_SIZE = 2048;
    static final int BAND_COUNT = 10;
    private static final int[] FREQUENCIES = { 31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 };

    private PlaybackSignal() {}

    static final class Equalizer {
        private final PeakingFilter[] filters;

        Equalizer(int sampleRate, int channels, float[] gains) {
            List<PeakingFilter> activeFilters = new ArrayList<>();
            for (int i = 0; i < BAND_COUNT; i++) {
                if (gains[i] == 0 || FREQUENCIES[i] * 2 >= sampleRate) continue;
                activeFilters.add(new PeakingFilter(sampleRate, channels, FREQUENCIES[i], gains[i]));
            }
            filters = activeFilters.toArray(new PeakingFilter[0]);
        }

        boolean isFlat() {
            return filters.length == 0;
        }

        double process(double sample, int channel) {
            for (PeakingFilter filter : filters) sample = filter.process(sample, channel);
            return sample;
        }
    }

    private static final class PeakingFilter {
        private final double b0, b1, b2, a1, a2;
        private final double[] delay1, delay2;

        PeakingFilter(int sampleRate, int channels, int frequency, float gain) {
            // Match the peaking filters (Q 1.1) used in the desktop audio graph.
            double angle = 2 * Math.PI * frequency / sampleRate;
            double alpha = Math.sin(angle) / 2.2;
            double amplitude = Math.pow(10, gain / 40d);
            double a0 = 1 + alpha / amplitude;
            b0 = (1 + alpha * amplitude) / a0;
            b1 = a1 = -2 * Math.cos(angle) / a0;
            b2 = (1 - alpha * amplitude) / a0;
            a2 = (1 - alpha / amplitude) / a0;
            delay1 = new double[channels];
            delay2 = new double[channels];
        }

        double process(double sample, int channel) {
            double output = b0 * sample + delay1[channel];
            delay1[channel] = b1 * sample - a1 * output + delay2[channel];
            delay2[channel] = b2 * sample - a2 * output;
            return output;
        }
    }

    static final class Spectrum {
        private static final int SPECTRUM_BANDS = 32;
        private final double[] real = new double[WINDOW_SIZE];
        private final double[] imaginary = new double[WINDOW_SIZE];
        private final double[] window = new double[WINDOW_SIZE];
        private final int[] reverse = new int[WINDOW_SIZE];
        // Inclusive FFT bin range per band; narrow low bands borrow their nearest bin.
        private final int[] bandStart = new int[SPECTRUM_BANDS];
        private final int[] bandEnd = new int[SPECTRUM_BANDS];

        Spectrum(int sampleRate) {
            int bits = Integer.numberOfTrailingZeros(WINDOW_SIZE);
            for (int i = 0; i < WINDOW_SIZE; i++) {
                window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WINDOW_SIZE - 1));
                reverse[i] = Integer.reverse(i) >>> (32 - bits);
            }
            double min = 48;
            double max = Math.min(16000, sampleRate / 2.0);
            double binWidth = (double) sampleRate / WINDOW_SIZE;
            for (int band = 0; band < SPECTRUM_BANDS; band++) {
                double low = min * Math.pow(max / min, (double) band / SPECTRUM_BANDS);
                double high = min * Math.pow(max / min, (double) (band + 1) / SPECTRUM_BANDS);
                int start = (int) Math.ceil(low / binWidth);
                int end = (int) Math.ceil(high / binWidth) - 1;
                if (end < start) start = end = (int) Math.round(Math.sqrt(low * high) / binWidth);
                bandStart[band] = Math.max(1, Math.min(WINDOW_SIZE / 2 - 1, start));
                bandEnd[band] = Math.max(bandStart[band], Math.min(WINDOW_SIZE / 2 - 1, end));
            }
        }

        float[] analyze(float[] samples) {
            for (int i = 0; i < WINDOW_SIZE; i++) {
                real[reverse[i]] = samples[i] * window[i];
                imaginary[reverse[i]] = 0;
            }
            for (int width = 2; width <= WINDOW_SIZE; width *= 2) {
                double stepReal = Math.cos(-2 * Math.PI / width);
                double stepImaginary = Math.sin(-2 * Math.PI / width);
                for (int block = 0; block < WINDOW_SIZE; block += width) {
                    double rotationReal = 1;
                    double rotationImaginary = 0;
                    for (int j = block; j < block + width / 2; j++) {
                        int twin = j + width / 2;
                        double nextReal = real[twin] * rotationReal - imaginary[twin] * rotationImaginary;
                        double nextImaginary = real[twin] * rotationImaginary + imaginary[twin] * rotationReal;
                        real[twin] = real[j] - nextReal;
                        imaginary[twin] = imaginary[j] - nextImaginary;
                        real[j] += nextReal;
                        imaginary[j] += nextImaginary;
                        double priorReal = rotationReal;
                        rotationReal = priorReal * stepReal - rotationImaginary * stepImaginary;
                        rotationImaginary = priorReal * stepImaginary + rotationImaginary * stepReal;
                    }
                }
            }
            float[] levels = new float[SPECTRUM_BANDS];
            for (int band = 0; band < SPECTRUM_BANDS; band++) {
                double energy = 0;
                for (int i = bandStart[band]; i <= bandEnd[band]; i++) {
                    energy = Math.max(energy, real[i] * real[i] + imaginary[i] * imaginary[i]);
                }
                double amplitude = Math.sqrt(energy) * 4 / WINDOW_SIZE;
                // ~42 dB of range with a gentle high-frequency tilt, so music fills the bars
                // instead of crowding the top (−64..0 dB left most bands at 70–90%).
                double decibels = 20 * Math.log10(amplitude) + 9.0 * band / (SPECTRUM_BANDS - 1);
                levels[band] = (float) Math.max(0, Math.min(1, (decibels + 46) / 42));
            }
            return levels;
        }
    }
}
