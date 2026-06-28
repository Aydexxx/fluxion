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

/** True on phone-sized viewports (below Tailwind's `md`). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
