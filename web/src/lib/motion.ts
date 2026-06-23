import type { Transition, Variants } from "framer-motion";

/** Calm, slightly weighted easing used across panels and entrances. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 320, damping: 32, mass: 0.7 };

export const riseIn: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

/** Container that orchestrates a staggered reveal of its children. */
export const stagger = (delay = 0, step = 0.06): Variants => ({
  hidden: {},
  show: { transition: { delayChildren: delay, staggerChildren: step } },
});

/** Variants flattened to no-ops, for when the user prefers reduced motion. */
export const still: Variants = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { duration: 0 } },
};
