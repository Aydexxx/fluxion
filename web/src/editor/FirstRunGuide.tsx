import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { CloseIcon } from "../components/icons";

const STORAGE_KEY = "fluxion.onboarding.editorGuide.v1";

type Placement = "left" | "top-right" | "right";

interface GuideStep {
  title: string;
  body: string;
  placement: Placement;
}

/**
 * A short, dismissible coachmark tour that runs once on a user's first time in
 * the editor. It points out the three things a newcomer needs — the node
 * library, the Run button, and the live data picker — then never shows again
 * (persisted in localStorage). Non-blocking: pointer events pass through to the
 * canvas everywhere except the card itself.
 */
const STEPS: GuideStep[] = [
  {
    title: "Start with the node library",
    body: "Drag a trigger, action, or AI model from here onto the canvas — or click one to drop it in the center.",
    placement: "left",
  },
  {
    title: "Run it anytime",
    body: "Press Run to execute the workflow. Nodes light up live as each step finishes, with results on the canvas.",
    placement: "top-right",
  },
  {
    title: "Wire data between steps",
    body: "Select a node and open its settings, then use the ⚡ data picker to insert live values from upstream steps.",
    placement: "right",
  },
];

/** Card position + pointer direction per placement, anchored to the editor layout regions. */
const PLACEMENT_STYLE: Record<Placement, { card: string; arrow: string }> = {
  left: { card: "left-[280px] top-[96px]", arrow: "-left-1.5 top-7" },
  "top-right": { card: "right-4 top-[68px]", arrow: "-top-1.5 right-8" },
  right: { card: "right-[420px] top-1/2 -translate-y-1/2", arrow: "-right-1.5 top-1/2 -translate-y-1/2" },
};

export function FirstRunGuide() {
  const reduce = useReducedMotion();
  const status = useEditor((s) => s.status);
  const [step, setStep] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (status !== "ready") return;
    let seen = false;
    try {
      seen = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Storage unavailable (e.g. private mode) — treat as unseen and show the tour.
    }
    if (seen) return;
    // A short beat after the canvas settles, so it doesn't fight the fit-view animation.
    const t = setTimeout(() => setActive(true), 900);
    return () => clearTimeout(t);
  }, [status]);

  const dismiss = () => {
    setActive(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Best-effort: if storage is unavailable the tour simply reappears next time.
    }
  };

  const next = () => {
    if (step >= STEPS.length - 1) dismiss();
    else setStep((s) => s + 1);
  };

  if (!active) return null;
  const current = STEPS[step];
  const place = PLACEMENT_STYLE[current.placement];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          className={`pointer-events-auto absolute w-[296px] rounded-2xl border border-white/10 p-4 shadow-2xl backdrop-blur-xl ${place.card}`}
          style={{
            background: "linear-gradient(165deg, var(--color-surface-2), var(--color-surface))",
            boxShadow:
              "0 0 0 1px color-mix(in oklab, var(--color-accent) 30%, transparent), 0 26px 60px -24px color-mix(in oklab, var(--color-accent) 55%, transparent)",
          }}
          role="dialog"
          aria-label="Editor walkthrough"
        >
          {/* pointer toward the anchored region */}
          <span
            aria-hidden
            className={`absolute size-3 rotate-45 border border-white/10 ${place.arrow}`}
            style={{ background: "var(--color-surface-2)" }}
          />

          <div className="flex items-start justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent-bright">
              {step + 1} / {STEPS.length}
            </span>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Skip walkthrough"
              className="-mr-1 -mt-1 rounded-md p-1 text-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <CloseIcon className="text-[14px]" />
            </button>
          </div>

          <h3 className="mt-1.5 font-display text-[15px] font-semibold text-ink">{current.title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{current.body}</p>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className="size-1.5 rounded-full transition-colors"
                  style={{ background: i === step ? "var(--color-accent)" : "color-mix(in oklab, white 18%, transparent)" }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {!isLast ? (
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-faint transition-colors hover:text-ink"
                >
                  Skip
                </button>
              ) : null}
              <button
                type="button"
                onClick={next}
                className="rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-all"
                style={{
                  background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
                  boxShadow: "0 8px 22px -10px color-mix(in oklab, var(--color-accent) 75%, transparent)",
                }}
              >
                {isLast ? "Got it" : "Next"}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
