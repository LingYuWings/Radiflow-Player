import { flushSync } from 'react-dom';

// Card-style page navigation built on the View Transition API.
//
// * The OLD page is a flattened snapshot of the whole document, so its glass
//   panels keep the blur they had on screen. CSS (index.css) clips it below the
//   title bar into a rounded card and makes it recede or drop away.
// * The NEW page stays live underneath. Its incoming surface rises into place
//   with a transform-only animation; transforms do not create a backdrop root,
//   so glass keeps sampling the real background for the whole motion.
//
// Never name glass elements for separate capture: a named element becomes a
// backdrop root and its blur would collapse during the transition.

export type ViewTransitionKind = 'page' | 'overlay' | 'section' | 'panel';
export type ViewTransitionDirection = 'forward' | 'back';

export interface CardEnter {
  selector: string;
  /** Starting transform; the element settles to its natural position. */
  from: string;
  duration?: number;
}

export interface ViewTransitionOptions {
  direction?: ViewTransitionDirection;
  enter?: CardEnter[];
}

type ViewTransitionHandle = { finished: Promise<void>; skipTransition?: () => void };
type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => ViewTransitionHandle;
};

export const CARD_EASE = 'cubic-bezier(.2, .9, .25, 1)';
const DEFAULT_ENTER_DURATION = 420;
const ENTER_ANIMATION_ID = 'rf-card-enter';
// Snapshot capture normally completes within a frame or two. If Chromium stalls
// (it otherwise waits up to 4s before aborting), apply the update directly so
// navigation never freezes on the old frame.
export const VIEW_TRANSITION_WATCHDOG_MS = 250;

let activeTransition: ViewTransitionHandle | null = null;

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

export function canUseViewTransition(doc: Document | undefined = typeof document === 'undefined' ? undefined : document) {
  const candidate = doc as DocumentWithViewTransition | undefined;
  return Boolean(
    candidate
    && typeof candidate.startViewTransition === 'function'
    && candidate.visibilityState === 'visible'
    && !prefersReducedMotion()
  );
}

/** Transform-only rise of the incoming surfaces (runs on live DOM). */
export function playCardEnter(enter: CardEnter[] | undefined, root: ParentNode | undefined = typeof document === 'undefined' ? undefined : document) {
  if (!enter?.length || !root || prefersReducedMotion()) return [];
  const animations: Animation[] = [];
  for (const { selector, from, duration = DEFAULT_ENTER_DURATION } of enter) {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element || typeof element.animate !== 'function') continue;
    element.getAnimations?.().forEach((animation) => { if (animation.id === ENTER_ANIMATION_ID) animation.cancel(); });
    const animation = element.animate([{ transform: from }, { transform: 'none' }], { duration, easing: CARD_EASE });
    animation.id = ENTER_ANIMATION_ID;
    animations.push(animation);
  }
  return animations;
}

/**
 * Apply a React state update as a card transition when supported. Falls back
 * to a plain synchronous update (reduced motion, hidden window, unsupported
 * runtime). The update always runs exactly once.
 */
export function runViewTransition(update: () => void, kind: ViewTransitionKind = 'page', options: ViewTransitionOptions = {}) {
  const direction = options.direction ?? 'forward';

  if (!canUseViewTransition()) {
    update();
    // Without snapshots the card rise alone still reads as an arrival.
    if (typeof window !== 'undefined' && !prefersReducedMotion()) playCardEnter(options.enter);
    return;
  }

  const doc = document as DocumentWithViewTransition;
  const root = doc.documentElement;
  // A newer navigation replaces the running one instead of queueing behind it.
  activeTransition?.skipTransition?.();
  root.dataset.rfTransition = kind;
  root.dataset.rfDirection = direction;

  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    flushSync(update);
    // Started before the new state is captured, so its first frame is the card's start.
    playCardEnter(options.enter);
  };

  try {
    const transition = doc.startViewTransition!(apply);
    activeTransition = transition;
    const watchdog = window.setTimeout(() => {
      if (applied) return;
      transition.skipTransition?.();
      apply();
    }, VIEW_TRANSITION_WATCHDOG_MS);
    transition.finished
      .finally(() => window.clearTimeout(watchdog))
      .catch(() => undefined);
    transition.finished
      .catch(() => undefined)
      .finally(() => {
        if (activeTransition === transition) {
          activeTransition = null;
          delete root.dataset.rfTransition;
          delete root.dataset.rfDirection;
        }
      });
  } catch {
    delete root.dataset.rfTransition;
    delete root.dataset.rfDirection;
    apply();
  }
}

// Shared presets so every surface moves with the same vocabulary.
export const cardEnter = {
  player: [{ selector: '.rf-player-surface', from: 'translateY(64px) scale(.94)', duration: 480 }],
  home: [{ selector: '.rf-home-layout', from: 'translateY(-10px) scale(.95)', duration: 460 }],
  overlay: [{ selector: '.rf-overlay-surface', from: 'translateY(48px) scale(.95)', duration: 440 }],
  sectionForward: [{ selector: '.rf-library-content', from: 'translateY(22px) scale(.98)', duration: 380 }],
  sectionBack: [{ selector: '.rf-library-content', from: 'translateY(-16px) scale(.98)', duration: 380 }],
  source: (direction: ViewTransitionDirection) => {
    const offset = direction === 'forward' ? 36 : -36;
    return [
      { selector: '.rf-library-content', from: `translateX(${offset}px) scale(.98)`, duration: 400 },
      { selector: '.rf-sidebar-content', from: `translateX(${offset * 0.6}px)`, duration: 400 },
    ];
  },
  panel: [{ selector: '.rf-player-panel-surface', from: 'translateY(36px) scale(.95)', duration: 420 }],
  focus: [
    { selector: '.rf-player-panel-surface', from: 'scale(.96)', duration: 440 },
    { selector: '.rf-player-primary', from: 'translateX(-32px) scale(.96)', duration: 440 },
  ],
} satisfies Record<string, CardEnter[] | ((direction: ViewTransitionDirection) => CardEnter[])>;
