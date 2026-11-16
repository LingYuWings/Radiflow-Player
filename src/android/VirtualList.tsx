import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return document.scrollingElement as HTMLElement;
}

/**
 * Fixed-height windowed list. Only rows near the viewport of the nearest
 * scrolling ancestor are in the DOM, which keeps style, layout and (on
 * WebView) the accessibility tree small for playlists and queues with
 * thousands of tracks.
 */
export function VirtualList<T>({ items, rowHeight, className, getKey, renderRow, overscan = 6, centerIndex }: {
  items: readonly T[];
  rowHeight: number;
  className?: string;
  getKey: (item: T) => string;
  renderRow: (item: T, index: number, style: CSSProperties) => ReactNode;
  overscan?: number;
  /** Scroll this row to the middle of the viewport when the list mounts. */
  centerIndex?: number;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 24]);
  const centered = useRef(false);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const scroller = scrollParent(element);
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewport = scroller.clientHeight;
      if (!viewport || !element.offsetParent) return;
      // Position of the list's top edge inside the scroller's visible area.
      const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const start = Math.max(0, Math.floor(-top / rowHeight) - overscan);
      const end = Math.min(items.length, Math.ceil((viewport - top) / rowHeight) + overscan);
      setRange(current => current[0] === start && current[1] === end ? current : [start, Math.max(start, end)]);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    if (!centered.current && centerIndex !== undefined && centerIndex >= 0 && scroller.clientHeight) {
      centered.current = true;
      const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTop = Math.max(0, top + centerIndex * rowHeight - (scroller.clientHeight - rowHeight) / 2);
    }
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller);
    resize.observe(element);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items.length, rowHeight, overscan, centerIndex]);

  const [start, end] = range;
  return <ul ref={list} className={className} style={{ position: 'relative', height: items.length * rowHeight }}>
    {items.slice(start, Math.min(end, items.length)).map((item, offset) => {
      const index = start + offset;
      return <Fragment key={getKey(item)}>{renderRow(item, index, {
        position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight, boxSizing: 'border-box',
      })}</Fragment>;
    })}
  </ul>;
}
