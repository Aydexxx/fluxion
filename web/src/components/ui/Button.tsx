import type { ButtonHTMLAttributes, ReactNode } from "react";
import { SpinnerIcon } from "../icons";

type Variant = "primary" | "secondary" | "danger";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed";

const VARIANT: Record<Variant, string> = {
  primary: "text-white",
  secondary: "border border-white/8 font-medium text-muted hover:bg-white/5 hover:text-ink",
  danger: "text-white",
};

const VARIANT_STYLE: Record<Variant, React.CSSProperties | undefined> = {
  primary: { background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))" },
  secondary: undefined,
  danger: { background: "linear-gradient(180deg, #ff7a7a, #d83a3a)", boxShadow: "0 8px 24px -8px rgba(216,58,58,0.6)" },
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

/** Shared action button for dialogs, confirms and forms. */
export function Button({ variant = "primary", loading = false, disabled, children, style, className = "", ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`${base} ${VARIANT[variant]} ${className}`}
      style={{ ...VARIANT_STYLE[variant], ...style }}
      {...rest}
    >
      {loading ? <SpinnerIcon className="animate-spin text-[15px]" /> : null}
      {children}
    </button>
  );
}
