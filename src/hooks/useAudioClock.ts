import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const identity = (time: number) => time;
// Subscribe at the consumer: a playback tick must not rerender the entire library.
export function useAudioClock(audioRef: RefObject<HTMLAudioElement | null> | undefined, fallback: number, select = identity) {
  const selector = useRef(select);
  selector.current = select;
  const [value, setValue] = useState(() => select(audioRef?.current?.currentTime ?? fallback));
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) { setValue(selector.current(fallback)); return; }
    const sync = () => setValue(selector.current(Number.isFinite(audio.currentTime) ? audio.currentTime : 0));
    const events = ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'emptied'] as const;
    sync();
    events.forEach((event) => audio.addEventListener(event, sync));
    return () => events.forEach((event) => audio.removeEventListener(event, sync));
  }, [audioRef, fallback, select]);
  return value;
}
