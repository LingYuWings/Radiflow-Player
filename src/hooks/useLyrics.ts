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
}

export function useLyrics({ enabled, title, artist }: UseLyricsOptions) {
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
    if (!normalizedTitle || !normalizedArtist) {
      setLyrics(parseLRC(EMPTY_LRC_TEXT));
      return;
    }

    const cacheKey = `${normalizedTitle}::${normalizedArtist}`.toLowerCase();
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
        const searchResponse = await fetch(`/api/proxy/search?word=${encodeURIComponent(`${normalizedTitle} ${normalizedArtist}`)}`, {
          signal: controller.signal,
        });
        const searchData = await searchResponse.json();
        const results = Array.isArray(searchData.data) ? searchData.data : searchData.data?.list;

        if (searchData.code !== 200 || !results?.length) {
          throw new Error('Song not found in search results');
        }

        const firstSong = results[0];
        const songId = firstSong.id || firstSong.songid || firstSong.songmid;
        if (!songId) {
          throw new Error('Could not find song ID');
        }

        const lyricResponse = await fetch(`/api/proxy/lyric?id=${songId}`, {
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
        cacheRef.current.set(cacheKey, {
          rawText: EMPTY_LRC_TEXT,
          lyrics: fallbackLyrics,
        });
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
  }, [artist, enabled, title]);

  return { lyrics, isLoadingLyrics };
}
