import { useEffect, useRef, useState } from 'react';
import { LyricLine, mergeLyrics, parseLRC, parseYRC } from '../utils/lyricsParser';

const EMPTY_LRC_TEXT = '[00:00.00]暂无歌词';

interface CachedLyricsPayload {
  rawText: string;
  lyrics: LyricLine[];
}

interface UseLyricsOptions {
  enabled: boolean;
  title: string;
  artist: string;
  fileUrl?: string;
}

export function useLyrics({ enabled, title, artist, fileUrl }: UseLyricsOptions) {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const cacheRef = useRef(new Map<string, CachedLyricsPayload>());

  useEffect(() => {
    if (!enabled) {
      setLyrics([]);
      setIsLoadingLyrics(false);
      return;
    }

    const normalizedTitle = title.trim();
    const normalizedArtist = artist.trim();
    const normalizedFileUrl = fileUrl?.trim() ?? '';
    if (!normalizedTitle || !normalizedArtist) {
      setIsLoadingLyrics(false);
      setLyrics(parseLRC(EMPTY_LRC_TEXT));
      return;
    }

    const cacheKey = normalizedFileUrl
      ? `file:${normalizedFileUrl}`
      : `track:${normalizedTitle}::${normalizedArtist}`.toLowerCase();
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setLyrics(cached.lyrics);
      setIsLoadingLyrics(false);
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;

    const fetchLyrics = async () => {
      setIsLoadingLyrics(true);
      try {
        const searchParams = new URLSearchParams({
          title: normalizedTitle,
          artist: normalizedArtist,
        });
        if (normalizedFileUrl) {
          searchParams.set('file', normalizedFileUrl);
        }

        const lyricResponse = await fetch(`/api/lyrics?${searchParams.toString()}`, {
          signal: controller.signal,
        });
        const lyricData = await lyricResponse.json();
        const lyricText = lyricData.data?.lrc || lyricData.data?.lyric;
        const translatedLyricText = lyricData.data?.tlyric || lyricData.data?.trans;
        const yrcText = lyricData.data?.yrc;

        if (lyricData.code !== 200 || (!lyricText && !yrcText)) {
          throw new Error('Lyrics not found in API response');
        }

        let parsedLyrics: LyricLine[] = [];
        if (yrcText) {
          parsedLyrics = parseYRC(yrcText);
          if (translatedLyricText) {
            parsedLyrics = mergeLyrics(parsedLyrics, parseLRC(translatedLyricText));
          }
        } else if (lyricText) {
          const combined = translatedLyricText ? `${lyricText}\n${translatedLyricText}` : lyricText;
          parsedLyrics = parseLRC(combined);
        }

        if (isCancelled) return;

        const payload: CachedLyricsPayload = {
          rawText: yrcText || lyricText || EMPTY_LRC_TEXT,
          lyrics: parsedLyrics,
        };
        cacheRef.current.set(cacheKey, payload);
        setLyrics(payload.lyrics);
      } catch (error) {
        if (controller.signal.aborted || isCancelled) return;

        console.error('Failed to fetch lyrics:', error);
        const fallbackLyrics = parseLRC(EMPTY_LRC_TEXT);
        setLyrics(fallbackLyrics);
      } finally {
        if (!isCancelled) {
          setIsLoadingLyrics(false);
        }
      }
    };

    fetchLyrics();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [artist, enabled, fileUrl, title]);

  return { lyrics, isLoadingLyrics };
}
