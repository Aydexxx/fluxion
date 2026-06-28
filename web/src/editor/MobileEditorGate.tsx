import { motion, useReducedMotion } from "framer-motion";
import { navigate } from "../lib/router";
import { GridIcon, Logo } from "../components/icons";

/**
 * A friendly full-screen gate shown over the canvas editor on phones. The editor
 * is a precise, desktop-first surface; rather than leave it broken under touch,
 * we explain that and offer a read-only peek or a way back.
 */
export function MobileEditorGate({ onPeek }: { onPeek: () => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-base/95 px-6 backdrop-blur-md">
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm text-center"
      >
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Logo className="text-[26px]" />
        </div>
        <h1 className="font-display text-[20px] font-semibold tracking-tight text-ink">
          The editor shines on desktop
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-[13.5px] leading-relaxed text-muted">
          Building workflows on an infinite canvas needs room to breathe and a pointer. Pop open Fluxion on a larger
          screen to drag nodes, wire data, and publish.
        </p>

        <div className="mt-7 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onPeek}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/12 px-4 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-white/5"
          >
            View read-only
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold text-white transition-all"
            style={{ background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))" }}
          >
            <GridIcon className="text-[16px]" />
            Back to workflows
          </button>
        </div>
      </motion.div>
    </div>
  );
}
