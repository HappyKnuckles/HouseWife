import { useRef, useState } from 'react';

/**
 * How long a touch has to hold before it counts as "pressed" for visual
 * feedback. Below this, `onPressIn` fired but nothing has committed to
 * being a tap yet — which is exactly the ambiguous window a swipe's Pan
 * gesture also lives in.
 *
 * Not zero: showing the dim instantly meant every swipe started with a
 * flash of "pressed" before gesture-handler decided this was a drag and
 * cancelled it — dim, undim, then the row starts sliding, three visible
 * steps for what should read as one motion. Android's own scrollable lists
 * use the same trick (a short delay before the tap highlight) to solve the
 * identical tap-vs-scroll ambiguity. A drag reliably cancels the press
 * before this elapses, so a real swipe never shows the dim at all; a
 * genuine tap holds well past it, so the feedback still reads as instant.
 */
const PRESS_DELAY_MS = 80;

/**
 * Delayed press-dim state, for any row/card that might also sit inside a
 * SwipeRow. Wire `onPressIn`/`onPressOut` to the Pressable and use `pressed`
 * in its style — see components/Card.tsx for the reference usage.
 */
export function usePressDim() {
  const [pressed, setPressed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onPressIn() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPressed(true), PRESS_DELAY_MS);
  }

  function onPressOut() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPressed(false);
  }

  return { pressed, onPressIn, onPressOut };
}
