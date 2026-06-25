import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertIcon, SpinnerIcon } from "../icons";

/**
 * Shared loading / empty / error surfaces. Every data-backed screen renders one
 * of these three so the app speaks with a single voice: a skeleton while
 * fetching, a centered invitation when there's nothing, and an honest,
 * retryable panel when a fetch fails (never a silent blank).
 */

/** A single shimmering placeholder block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg border border-white/6 bg-surface/40 ${className}`} />;
}

/** A grid of card-shaped skeletons, matching the page's real card grid. */
export function CardSkeletonGrid({
  count = 6,
  className = "grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3",
  cardClassName = "h-[168px]",
}: {
  count?: number;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={`rounded-2xl ${cardClassName}`} />
      ))}
    </div>
  );
}

/** A calm full-section spinner, for charts and panels that load as a unit. */
export function LoadingState({ label, className = "py-24" }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-muted ${className}`}>
      <SpinnerIcon className="animate-spin text-[20px]" />
      {label ? <p className="text-[13px] text-faint">{label}</p> : null}
    </div>
  );
}

/**
 * The shared empty state: an iconic badge, a title, a line of copy, and an
 * optional primary/secondary action pair. Used wherever a list comes back empty.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`relative flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 px-6 py-20 text-center ${className}`}
    >
      <div aria-hidden className="accent-ring mb-5 flex size-14 items-center justify-center rounded-2xl bg-surface text-[24px] text-accent">
        {icon}
      </div>
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </motion.div>
  );
}

/**
 * The shared error state: an honest, retryable panel. Replaces the old pattern
 * of a failed fetch silently rendering as an empty list.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className = "",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-3xl border border-dashed border-red-500/20 px-6 py-20 text-center ${className}`}
    >
      <div aria-hidden className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-red-500/10 text-[24px] text-red-300 ring-1 ring-red-500/25">
        <AlertIcon />
      </div>
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      {message ? <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-xl border border-white/10 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/5"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
