import type { ExecutionStatus } from "../lib/types";
import { statusVisual, toNodeRunStatus } from "./runStatus";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Small colored status pill used across the run UI (panel, results bar, history). */
export function StatusBadge({ status, dim = false }: { status: ExecutionStatus; dim?: boolean }) {
  const { color } = statusVisual(toNodeRunStatus(status));
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        color,
        background: `color-mix(in oklab, ${color} ${dim ? 10 : 16}%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {capitalize(status)}
    </span>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Labeled, monospaced block for a captured input/output/error payload. */
export function JsonBlock({ label, value, tone = "default" }: { label: string; value: unknown; tone?: "default" | "error" }) {
  const empty = value === undefined || value === null;
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.13em] text-faint">{label}</div>
      <pre
        className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-[12px] leading-relaxed"
        style={{
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          color: tone === "error" ? "#ffb4b4" : empty ? "var(--color-faint)" : "var(--color-ink)",
          background: tone === "error" ? "color-mix(in oklab, #ff6b6b 8%, transparent)" : "color-mix(in oklab, white 3%, transparent)",
          borderColor: tone === "error" ? "color-mix(in oklab, #ff6b6b 28%, transparent)" : "color-mix(in oklab, white 8%, transparent)",
        }}
      >
        {formatValue(value)}
      </pre>
    </div>
  );
}
