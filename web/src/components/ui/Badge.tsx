import type { ReactNode } from "react";

/**
 * A small pill in any accent color. The single dot + label pattern used for
 * statuses and tags across the app, expressed once. Pass a CSS color (token or
 * hex); the background/glow are derived from it for a consistent look.
 */
export function Badge({
  color = "var(--color-accent)",
  dot = true,
  glow = false,
  children,
  className = "",
}: {
  color?: string;
  dot?: boolean;
  /** Add a soft glow on the dot (used for "live"/active states). */
  glow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      style={{ color, background: `color-mix(in oklab, ${color} 13%, transparent)` }}
    >
      {dot ? (
        <span
          className="size-1.5 rounded-full"
          style={{ background: color, boxShadow: glow ? `0 0 8px ${color}` : undefined }}
        />
      ) : null}
      {children}
    </span>
  );
}
