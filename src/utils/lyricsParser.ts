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

export function parseYRC(yrc: string): LyricLine[] {
  const lines = yrc.split('\n');
  const result: LyricLine[] = [];
  
  // Line format: [start_ms, duration_ms]content
  const lineRegex = /^\[(\d+),(\d+)\](.*)$/;
  // Word format: text(start_ms, duration_ms)
  const wordRegex = /([^()]+)\((\d+),(\d+)\)/g;

  for (const line of lines) {
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
      words.push({
        startTime: parseInt(wordMatch[2]) / 1000,
        duration: parseInt(wordMatch[3]) / 1000,
        text: wordMatch[1]
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
      result.push({
        startTime,
        endTime: startTime + duration,
        text: content.trim()
      });
    }
  }

  return result.sort((a, b) => a.startTime - b.startTime);
}

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
