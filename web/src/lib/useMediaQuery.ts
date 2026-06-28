import { useEffect, useState } from "react";

/** Subscribe to a CSS media query, re-rendering when it starts/stops matching. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * True on phone-sized viewports (below Tailwind's `md`). Width-only — used for
 * responsive *layout* choices (e.g. the nav becomes a drawer), where a narrow
 * desktop window legitimately wants the compact treatment.
 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/**
 * True only on a *genuine* touch phone: a coarse pointer AND a very small
 * viewport. Deliberately NOT width-only, so a desktop browser shrunk or
 * split-screened (a fine pointer at any width) is never treated as mobile — the
 * full editor stays usable. Use this to gate touch-hostile surfaces like the
 * canvas editor, not for plain responsive layout.
 */
export function useIsTouchMobile(): boolean {
  return useMediaQuery("(pointer: coarse) and (max-width: 600px)");
}
