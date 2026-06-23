import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { EASE } from "../lib/motion";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.26, ease: EASE }}
            className="relative w-full max-w-[400px] overflow-hidden rounded-2xl glass p-5"
            style={{ boxShadow: "0 30px 80px -30px rgba(0,0,0,0.85)" }}
          >
            <h3 className="font-display text-[17px] font-semibold text-ink">{title}</h3>
            <div className="mt-2 text-[13.5px] leading-relaxed text-muted">{body}</div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-white/8 px-3.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-ink"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-all disabled:opacity-60"
                style={
                  destructive
                    ? { background: "linear-gradient(180deg, #ff7a7a, #d83a3a)", boxShadow: "0 8px 24px -8px rgba(216,58,58,0.6)" }
                    : { background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))" }
                }
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
