// Shared, non-overshooting curves: decisive departure, softer arrival.
export const PAGE_ENTER_EASE = [0.16, 1, 0.3, 1] as const;
export const PAGE_EXIT_EASE = [0.4, 0, 0.8, 0.4] as const;
export const PAGE_TRANSITION = { type: 'tween' as const, duration: 0.32, ease: PAGE_ENTER_EASE };

export function pageMotion(reduced: boolean | null, axis: 'x' | 'y' = 'y', distance = 14) {
  return {
    initial: { opacity: 0, [axis]: reduced ? 0 : distance },
    animate: { opacity: 1, [axis]: 0 },
    exit: { opacity: 0, [axis]: reduced ? 0 : distance * 0.5,
      transition: { type: 'tween' as const, duration: reduced ? 0 : 0.16, ease: PAGE_EXIT_EASE } },
    transition: { ...PAGE_TRANSITION, duration: reduced ? 0 : PAGE_TRANSITION.duration },
  };
}

// Animate the retained content surface, not a keyed replacement of the library.
// No opacity/filter here: card backdrop sampling must remain intact.
export function animatePageArrival(element: HTMLElement | null, reduced: boolean) {
  if (!element || reduced || element.closest('[inert]') || typeof element.animate !== 'function') return;
  return element.animate([{ transform: 'translateY(10px)' }, { transform: 'translateY(0)' }], {
    duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  });
}
