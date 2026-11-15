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
        private static final int SPECTRUM_BANDS = 16;
        private final double[] real = new double[WINDOW_SIZE];
        private final double[] imaginary = new double[WINDOW_SIZE];
        private final double[] window = new double[WINDOW_SIZE];
        private final int[] reverse = new int[WINDOW_SIZE];
        private final int[] bands = new int[WINDOW_SIZE / 2];

        Spectrum(int sampleRate) {
            int bits = Integer.numberOfTrailingZeros(WINDOW_SIZE);
            for (int i = 0; i < WINDOW_SIZE; i++) {
                window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WINDOW_SIZE - 1));
                reverse[i] = Integer.reverse(i) >>> (32 - bits);
            }
            double min = 48;
            double max = Math.min(16000, sampleRate / 2.0);
            for (int i = 0; i < bands.length; i++) {
                double frequency = i * (double) sampleRate / WINDOW_SIZE;
                bands[i] = frequency < min || frequency >= max ? -1
                    : Math.min(SPECTRUM_BANDS - 1, (int) (SPECTRUM_BANDS * Math.log(frequency / min) / Math.log(max / min)));
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
            for (int i = 1; i < bands.length; i++) {
                int band = bands[i];
                if (band < 0) continue;
                float energy = (float) (real[i] * real[i] + imaginary[i] * imaginary[i]);
                levels[band] = Math.max(levels[band], energy);
            }
            for (int i = 0; i < levels.length; i++) {
                double amplitude = Math.sqrt(levels[i]) * 4 / WINDOW_SIZE;
                levels[i] = (float) Math.max(0, Math.min(1, (20 * Math.log10(amplitude) + 64) / 64));
            }
            return levels;
        }
    }
}
