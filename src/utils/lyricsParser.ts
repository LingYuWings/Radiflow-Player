export interface Word {
  text: string;
  startTime: number; // in seconds
  duration: number; // in seconds
}

export interface LyricLine {
  startTime: number; // in seconds
  endTime?: number;
  text: string;
  translation?: string;
  words?: Word[];
}

export interface SongMetadata {
  title: string;
  artist: string;
  album?: string;
  cover?: string;
}

// Parse classic LRC text into timestamped lines. The parser accepts repeated
// timestamps per line and opportunistically extracts inline translations.
export function parseLRC(lrc: string): LyricLine[] {
  const lines = lrc.split('\n');
  const tempResult: LyricLine[] = [];
  
  // Support multiple timestamps like [00:10.00][00:20.00]Lyric
  // and various formats like [00:10], [00:10.00], [00:10.000]
  const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

  for (const line of lines) {
    const times: number[] = [];
    let match;
    
    // Reset regex index for each line
    timeRegex.lastIndex = 0;
    
    while ((match = timeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1]);
      const seconds = parseFloat(match[2]);
      times.push(minutes * 60 + seconds);
    }
    
    if (times.length === 0) continue;
    
    // Remove all timestamps to get the content
    let content = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
    
    // Check for common separators in the same line (e.g., "Original / Translation")
    const separators = [' / ', ' // ', ' | '];
    let translation = '';
    
    for (const sep of separators) {
      if (content.includes(sep)) {
        const parts = content.split(sep);
        content = parts[0].trim();
        translation = parts[1].trim();
        break;
      }
    }

    for (const startTime of times) {
      tempResult.push({
        startTime,
        text: content || ' ',
        translation: translation || undefined
      });
    }
  }

  // Merge duplicate timestamps (likely bilingual lyrics)
  const mergedResult: LyricLine[] = [];
  const sortedTemp = tempResult.sort((a, b) => a.startTime - b.startTime);

  for (const line of sortedTemp) {
    const text = line.text.trim();
    if (text === '//') continue;

    const existing = mergedResult.find(l => Math.abs(l.startTime - line.startTime) < 0.05);
    if (existing) {
      if (existing.text === text) continue;
      
      if (!existing.translation && text) {
        existing.translation = text;
      } else if (existing.translation && text && existing.translation !== text) {
        existing.translation += ' ' + text;
      }
    } else {
      mergedResult.push({
        ...line,
        text: text || ' '
      });
    }
  }

  // Calculate end times
  for (let i = 0; i < mergedResult.length; i++) {
    if (i < mergedResult.length - 1) {
      mergedResult[i].endTime = mergedResult[i + 1].startTime;
    } else {
      mergedResult[i].endTime = mergedResult[i].startTime + 10;
    }
  }

  return mergedResult;
}

// Parse YRC word-timed lyrics. Preserving word timing allows the lyric view to
// animate karaoke-style highlights instead of only whole-line state changes.
export function parseYRC(yrc: string): LyricLine[] {
  const lines = yrc.split('\n');
  const result: LyricLine[] = [];
  
  // Line format: [start_ms, duration_ms]content
  const lineRegex = /^\[(\d+),(\d+)\](.*)$/;
  // Word format: (start_ms, duration_ms, unknown)text
  const wordRegex = /\((\d+),(\d+),(\d+)\)([^()]+)/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const metadata = JSON.parse(line) as { t?: unknown; c?: Array<{ tx?: unknown }> };
        const startTime = typeof metadata.t === 'number' && Number.isFinite(metadata.t)
          ? metadata.t / 1000
          : NaN;
        const text = Array.isArray(metadata.c)
          ? metadata.c
            .map((item) => typeof item?.tx === 'string' ? item.tx : '')
            .join('')
            .trim()
          : '';

        if (Number.isFinite(startTime) && text) {
          result.push({
            startTime,
            text,
          });
        }
      } catch {
        // Ignore malformed metadata lines and keep parsing timed lyric lines.
      }

      continue;
    }

    const match = line.match(lineRegex);
    if (!match) continue;

    const startTime = parseInt(match[1]) / 1000;
    const duration = parseInt(match[2]) / 1000;
    const content = match[3];

    const words: Word[] = [];
    let wordMatch;
    
    // Reset regex index
    wordRegex.lastIndex = 0;
    
    while ((wordMatch = wordRegex.exec(content)) !== null) {
      const text = wordMatch[4];
      if (!text) {
        continue;
      }

      words.push({
        startTime: parseInt(wordMatch[1]) / 1000,
        duration: parseInt(wordMatch[2]) / 1000,
        text
      });
    }

    if (words.length > 0) {
      result.push({
        startTime,
        endTime: startTime + duration,
        text: words.map(w => w.text).join(''),
        words
      });
    } else if (content.trim()) {
      const plainText = content.replace(/\(\d+,\d+,\d+\)/g, '').trim();
      if (!plainText) {
        continue;
      }

      result.push({
        startTime,
        endTime: startTime + duration,
        text: plainText
      });
    }
  }

  const sortedResult = result.sort((a, b) => a.startTime - b.startTime);

  for (let index = 0; index < sortedResult.length; index += 1) {
    const current = sortedResult[index];
    if (current.endTime !== undefined) {
      continue;
    }

    const next = sortedResult[index + 1];
    current.endTime = next && next.startTime > current.startTime
      ? next.startTime
      : current.startTime + 10;
  }

  return sortedResult;
}

// Merge a secondary lyric track, usually a translation, into the primary timed
// lyric structure by fuzzy-matching timestamps.
export function mergeLyrics(primary: LyricLine[], secondary: LyricLine[]): LyricLine[] {
  const result = [...primary];
  
  for (const sLine of secondary) {
    if (sLine.text === '//' || !sLine.text) continue;
    
    const existing = result.find(p => Math.abs(p.startTime - sLine.startTime) < 0.1);
    if (existing) {
      if (existing.text !== sLine.text) {
        existing.translation = sLine.text;
      }
    }
  }
  
  return result;
}
