import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CloseIcon } from "../icons";

export interface TourStep {
  /** CSS selector of the element to spotlight (a `[data-tour="…"]`). Omit for a centered step. */
  target?: string;
  title: string;
  body: string;
}

interface Props {
  steps: TourStep[];
  /** localStorage key marking this tour as completed/skipped. */
  storageKey: string;
  /** Only start once this is true (e.g. the page is ready). */
  enabled?: boolean;
  /** Delay before the tour appears, letting the page settle. */
  startDelay?: number;
}

const CARD_WIDTH = 300;
const GAP = 12;

function hasSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* best-effort: if storage is unavailable the tour simply reappears next time */
  }
}

/**
 * A calm, dismissible coachmark tour. Each step optionally spotlights a live
 * element (found via a `[data-tour]` selector) with a glowing ring and an
 * anchored card; steps without a target render centered. Non-blocking (pointer
 * events pass through everywhere but the card), remembered once finished or
 * skipped, and animation-free under prefers-reduced-motion.
 */
export function OnboardingTour({ steps, storageKey, enabled = true, startDelay = 700 }: Props) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(false);
  const [liveSteps, setLiveSteps] = useState<TourStep[]>([]);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Decide whether to start: not seen, enabled, and at least one showable step
  // (a step with a missing target is dropped so we never point at nothing).
  useEffect(() => {
    if (!enabled || hasSeen(storageKey)) return;
    const t = setTimeout(() => {
      const showable = steps.filter((s) => !s.target || document.querySelector(s.target));
      if (showable.length === 0) return;
      setLiveSteps(showable);
      setStep(0);
      setActive(true);
    }, startDelay);
    return () => clearTimeout(t);
  }, [enabled, storageKey, steps, startDelay]);

  const current = active ? liveSteps[step] : undefined;

  // Track the spotlighted element's rect; recompute on resize and any scroll.
  useLayoutEffect(() => {
    if (!current) return;
    const measure = () => {
      const el = current.target ? document.querySelector(current.target) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [current]);

  // Position the card relative to the spotlight (below if there's room, else above),
  // clamped to the viewport. Measured after render so the height is real.
  useLayoutEffect(() => {
    if (!active) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardH = cardRef.current?.offsetHeight ?? 160;
    if (!rect) {
      setPos({ top: Math.max(GAP, (vh - cardH) / 2), left: Math.max(GAP, (vw - CARD_WIDTH) / 2) });
      return;
    }
    const below = rect.bottom + GAP;
    const above = rect.top - cardH - GAP;
    const top = below + cardH <= vh - GAP || above < GAP ? below : above;
    const left = Math.min(Math.max(GAP, rect.left), vw - CARD_WIDTH - GAP);
    setPos({ top: Math.min(Math.max(GAP, top), vh - cardH - GAP), left });
  }, [active, rect, step]);

  if (!active || !current) return null;

  const finish = () => {
    setActive(false);
    markSeen(storageKey);
  };
  const next = () => (step >= liveSteps.length - 1 ? finish() : setStep((s) => s + 1));
  const isLast = step === liveSteps.length - 1;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {/* Spotlight ring around the anchored element. */}
      {rect ? (
        <motion.div
          aria-hidden
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="absolute rounded-xl"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow:
              "0 0 0 2px color-mix(in oklab, var(--color-accent) 70%, transparent), 0 0 0 9999px color-mix(in oklab, #050507 30%, transparent), 0 0 32px -4px color-mix(in oklab, var(--color-accent) 70%, transparent)",
          }}
        />
      ) : null}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          ref={cardRef}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          role="dialog"
          aria-label="Product walkthrough"
          className="pointer-events-auto fixed rounded-2xl border border-white/10 p-4 shadow-2xl backdrop-blur-xl"
          style={{
            width: CARD_WIDTH,
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? "visible" : "hidden",
            background: "linear-gradient(165deg, var(--color-surface-2), var(--color-surface))",
            boxShadow:
              "0 0 0 1px color-mix(in oklab, var(--color-accent) 30%, transparent), 0 26px 60px -24px color-mix(in oklab, var(--color-accent) 55%, transparent)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent-bright">
              {step + 1} / {liveSteps.length}
            </span>
            <button
              type="button"
              onClick={finish}
              aria-label="Skip tour"
              className="-mr-1 -mt-1 rounded-md p-1 text-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <CloseIcon className="text-[14px]" />
            </button>
          </div>

          <h3 className="mt-1.5 font-display text-[15px] font-semibold text-ink">{current.title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{current.body}</p>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-1.5">
              {liveSteps.map((_, i) => (
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
                  onClick={finish}
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
    </div>,
    document.body,
  );
}
