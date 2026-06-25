/* This module intentionally co-locates the <ToastProvider> with its useToast hook
   and imperative bridge so consumers have a single import surface. That trips the
   Fast Refresh "components-only export" heuristic, which is a dev-HMR nicety. */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE } from "../../lib/motion";
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon, SpinnerIcon } from "../icons";

export type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastOptions {
  /** Override the auto-dismiss delay in ms. Pass `null` to keep it until dismissed. */
  duration?: number | null;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number | null;
}

interface PromiseMessages<T> {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((err: unknown) => string);
}

export interface ToastApi {
  show: (kind: ToastKind, message: string, opts?: ToastOptions) => string;
  success: (message: string, opts?: ToastOptions) => string;
  error: (message: string, opts?: ToastOptions) => string;
  info: (message: string, opts?: ToastOptions) => string;
  loading: (message: string, opts?: ToastOptions) => string;
  update: (id: string, patch: { kind?: ToastKind; message?: string } & ToastOptions) => void;
  dismiss: (id: string) => void;
  /** Track a promise: shows a loading toast that resolves to success/error. */
  promise: <T>(promise: Promise<T>, messages: PromiseMessages<T>) => Promise<T>;
}

// Default auto-dismiss per kind. Loading toasts persist until updated/dismissed.
const DEFAULT_DURATION: Record<ToastKind, number | null> = {
  success: 4200,
  info: 4200,
  error: 6000,
  loading: null,
};

const ToastContext = createContext<ToastApi | null>(null);

/** Primary React API. Must be used under <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

let nextId = 0;
const genId = () => `t${++nextId}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const arm = useCallback(
    (id: string, duration: number | null) => {
      clearTimer(id);
      if (duration != null) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    },
    [clearTimer, dismiss],
  );

  const show = useCallback(
    (kind: ToastKind, message: string, opts?: ToastOptions) => {
      const id = genId();
      const duration = opts?.duration === undefined ? DEFAULT_DURATION[kind] : opts.duration;
      setToasts((prev) => [...prev, { id, kind, message, duration }]);
      arm(id, duration);
      return id;
    },
    [arm],
  );

  const update = useCallback(
    (id: string, patch: { kind?: ToastKind; message?: string } & ToastOptions) => {
      setToasts((prev) => {
        let nextDuration: number | null = null;
        const next = prev.map((t) => {
          if (t.id !== id) return t;
          const kind = patch.kind ?? t.kind;
          nextDuration = patch.duration === undefined ? DEFAULT_DURATION[kind] : patch.duration;
          return { ...t, kind, message: patch.message ?? t.message, duration: nextDuration };
        });
        if (next.some((t) => t.id === id)) arm(id, nextDuration);
        return next;
      });
    },
    [arm],
  );

  const promise = useCallback(
    <T,>(p: Promise<T>, messages: PromiseMessages<T>) => {
      const id = show("loading", messages.loading);
      p.then(
        (value) => {
          const msg = typeof messages.success === "function" ? messages.success(value) : messages.success;
          update(id, { kind: "success", message: msg });
        },
        (err) => {
          const msg = typeof messages.error === "function" ? messages.error(err) : messages.error;
          update(id, { kind: "error", message: msg });
        },
      );
      return p;
    },
    [show, update],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, o) => show("success", m, o),
      error: (m, o) => show("error", m, o),
      info: (m, o) => show("info", m, o),
      loading: (m, o) => show("loading", m, o),
      update,
      dismiss,
      promise,
    }),
    [show, update, dismiss, promise],
  );

  // Bridge the live api to the module-level imperative `toast` so non-React code
  // (e.g. zustand stores) can fire toasts too. Flush anything queued before mount.
  useEffect(() => {
    bridge = api;
    while (pending.length) pending.shift()!(api);
    return () => {
      if (bridge === api) bridge = null;
    };
  }, [api]);

  // Clean up timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((handle) => clearTimeout(handle));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const ICON: Record<ToastKind, ReactNode> = {
  success: <CheckIcon />,
  error: <AlertIcon />,
  info: <InfoIcon />,
  loading: <SpinnerIcon className="animate-spin" />,
};

const ACCENT: Record<ToastKind, string> = {
  success: "#34d0a8",
  error: "#ff6b6b",
  info: "#7c5cff",
  loading: "#8d8d99",
};

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const reduce = useReducedMotion();
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[110] flex w-full max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2 sm:max-w-[420px]"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduce}
            role={t.kind === "error" ? "alert" : "status"}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="pointer-events-auto flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left glass"
            style={{ boxShadow: "0 20px 50px -20px rgba(0,0,0,0.8)" }}
          >
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[12px]"
              style={{ color: ACCENT[t.kind], background: `color-mix(in oklab, ${ACCENT[t.kind]} 16%, transparent)` }}
            >
              {ICON[t.kind]}
            </span>
            <span className="min-w-0 flex-1 text-[13px] text-ink">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(t.id)}
              className="-mr-1 shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <CloseIcon className="text-[13px]" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ── Imperative bridge ──────────────────────────────────────────────────────
   For code that runs outside React (zustand stores, plain modules). Components
   should prefer the `useToast()` hook. Calls before the provider mounts queue
   and flush on mount. */
let bridge: ToastApi | null = null;
const pending: Array<(api: ToastApi) => void> = [];

function withApi(fn: (api: ToastApi) => void) {
  if (bridge) fn(bridge);
  else pending.push(fn);
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => withApi((a) => a.success(message, opts)),
  error: (message: string, opts?: ToastOptions) => withApi((a) => a.error(message, opts)),
  info: (message: string, opts?: ToastOptions) => withApi((a) => a.info(message, opts)),
  loading: (message: string, opts?: ToastOptions) => withApi((a) => a.loading(message, opts)),
  dismiss: (id: string) => withApi((a) => a.dismiss(id)),
};
