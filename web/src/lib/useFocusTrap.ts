import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// A stack of the currently-mounted traps. Only the topmost one reacts to keys,
// so nested overlays (e.g. a confirm opened over a dialog) don't fight over Tab.
const stack: symbol[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Confines focus to the returned ref while `active`, moves focus into it on
 * open, restores focus to the previously-focused element on close, and calls
 * `onClose` on Escape. Handles nested overlays via a shared trap stack.
 *
 * The element the ref is attached to should be focusable (`tabIndex={-1}`).
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  onClose: () => void,
) {
  const ref = useRef<T>(null);
  // Keep the latest onClose without re-arming the trap effect on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const token = Symbol("trap");
    stack.push(token);
    const isTop = () => stack[stack.length - 1] === token;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus in: first focusable, else the container itself.
    (focusables(node)[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop()) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;
      const items = focusables(node);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey && (activeEl === first || !node.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const i = stack.indexOf(token);
      if (i !== -1) stack.splice(i, 1);
      // Restore focus to whatever was focused before we opened.
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
