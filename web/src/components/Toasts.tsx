import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useToasts, type ToastKind } from "../store/toasts";
import { EASE } from "../lib/motion";

const ACCENT: Record<ToastKind, string> = {
  success: "#34d0a8",
  error: "#ff6b6b",
  info: "#7c5cff",
};

export function Toasts() {
  const reduce = useReducedMotion();
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            layout={!reduce}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-xl px-4 py-2.5 text-left glass"
            style={{ boxShadow: "0 20px 50px -20px rgba(0,0,0,0.8)" }}
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: ACCENT[t.kind], boxShadow: `0 0 10px ${ACCENT[t.kind]}` }} />
            <span className="text-[13px] text-ink">{t.message}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
