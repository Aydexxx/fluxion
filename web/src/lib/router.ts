import { useSyncExternalStore } from "react";

/** Minimal history-backed router — no dependency needed for a handful of routes. */
export type Route =
  | { name: "login" }
  | { name: "register" }
  | { name: "dashboard" }
  | { name: "runs" }
  | { name: "analytics" }
  | { name: "editor"; workflowId: string }
  | { name: "notfound" };

function parse(pathname: string): Route {
  if (pathname === "/login") return { name: "login" };
  if (pathname === "/register") return { name: "register" };
  if (pathname === "/" || pathname === "") return { name: "dashboard" };
  if (pathname === "/runs") return { name: "runs" };
  if (pathname === "/analytics") return { name: "analytics" };
  const editor = pathname.match(/^\/workflows\/([^/]+)$/);
  if (editor) return { name: "editor", workflowId: decodeURIComponent(editor[1]) };
  return { name: "notfound" };
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (path === window.location.pathname + window.location.search) return;
  if (opts.replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => "/",
  );
  return parse(pathname);
}
