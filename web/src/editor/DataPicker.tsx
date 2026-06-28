import { useState } from "react";
import type { SampleSource } from "./sampleData";
import type { WorkspaceVariable, WorkspaceSecret } from "../lib/types";
import { categoryAccent, getNodeSpec } from "./nodeCatalog";
import { formatValue } from "./references";
import { BracesIcon, ChevronRightIcon, KeyIcon } from "../components/icons";

/**
 * Popover tree of the data available to a node: workspace variables/secrets, the
 * trigger payload, and every upstream node's sample output (pinned mock or
 * last-run). Clicking any field inserts a `{{ ... }}` reference for it via
 * `onPick`. Mouse-down is suppressed throughout so the host input keeps focus
 * and its caret position.
 */
export function DataPicker({
  sources,
  variables = [],
  secrets = [],
  onPick,
  onManage,
  onClose,
}: {
  sources: SampleSource[];
  variables?: WorkspaceVariable[];
  secrets?: WorkspaceSecret[];
  onPick: (ref: string) => void;
  /** Opens the variables & secrets settings dialog from the picker. */
  onManage?: () => void;
  onClose: () => void;
}) {
  const hasAny = sources.some((s) => s.origin !== "none");

  return (
    <div
      // Keep the focused input from blurring when interacting with the picker.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute right-0 z-40 mt-1.5 max-h-72 w-[19rem] overflow-y-auto rounded-xl border border-white/10 bg-raised/95 p-1.5 shadow-2xl backdrop-blur-xl"
      style={{ boxShadow: "0 24px 60px -24px rgba(0,0,0,0.9)" }}
      role="dialog"
      aria-label="Insert data reference"
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Insert data</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 text-[11px] text-faint transition-colors hover:text-ink"
        >
          esc
        </button>
      </div>

      {variables.length > 0 ? (
        <KeyedSection
          title="Variables"
          icon={<BracesIcon />}
          accent="#5b8cff"
          items={variables.map((v) => ({ key: v.key, preview: v.value, ref: `vars.${v.key}` }))}
          onPick={onPick}
        />
      ) : null}

      {secrets.length > 0 ? (
        <KeyedSection
          title="Secrets"
          icon={<KeyIcon />}
          accent="#e0a33e"
          items={secrets.map((s) => ({ key: s.key, preview: "••••••", ref: `secrets.${s.key}` }))}
          onPick={onPick}
        />
      ) : null}

      {!hasAny ? (
        <p className="px-2 py-3 text-[12px] leading-relaxed text-faint">
          No sample data yet. Run the workflow, or pin sample data to an upstream node, to map fields here.
        </p>
      ) : (
        sources.map((source) => <SourceTree key={source.id} source={source} onPick={onPick} />)
      )}

      {onManage ? (
        <>
          <div className="my-1 h-px bg-white/8" />
          <button
            type="button"
            onClick={onManage}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
          >
            <BracesIcon className="text-[12px] text-faint" />
            Manage variables &amp; secrets
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * A flat, collapsible section of workspace key/value references (variables or
 * secrets). Each row inserts `{{ vars.KEY }}` / `{{ secrets.KEY }}`; secret
 * values are shown masked.
 */
function KeyedSection({
  title,
  icon,
  accent,
  items,
  onPick,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  items: { key: string; preview: string; ref: string }[];
  onPick: (ref: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        <ChevronRightIcon
          className="text-[12px] text-faint transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        />
        <span className="flex size-4 items-center justify-center text-[12px]" style={{ color: accent }}>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{title}</span>
        <span className="text-[10px] text-faint">{items.length}</span>
      </button>
      {open ? (
        <div className="ml-3 border-l border-white/8 pl-1">
          {items.map((item) => (
            <div key={item.key} className="group flex items-center rounded-md px-2 py-1 hover:bg-white/5">
              <span className="mr-1 inline-block w-3 shrink-0" />
              <button
                type="button"
                onClick={() => onPick(`{{ ${item.ref} }}`)}
                className="flex min-w-0 flex-1 items-center text-left"
                title={`Insert {{ ${item.ref} }}`}
              >
                <span className="truncate font-mono text-[11.5px] text-accent-bright group-hover:text-accent">
                  {item.key}
                </span>
                <span className="ml-2 truncate font-mono text-[11px] text-faint">{item.preview}</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SourceTree({ source, onPick }: { source: SampleSource; onPick: (ref: string) => void }) {
  const [open, setOpen] = useState(source.origin !== "none");
  const accent = categoryAccent(source.nodeType);
  const Icon = getNodeSpec(source.nodeType).icon;
  const disabled = source.origin === "none";

  return (
    <div className="rounded-lg">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
      >
        <ChevronRightIcon
          className="text-[12px] text-faint transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        />
        <span className="flex size-4 items-center justify-center text-[12px]" style={{ color: accent }}>
          <Icon />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{source.title}</span>
        <OriginBadge origin={source.origin} />
      </button>

      {open && !disabled ? (
        <div className="ml-3 border-l border-white/8 pl-1">
          <ValueNode label={source.basePath} path={source.basePath} value={source.sample} onPick={onPick} depth={0} />
        </div>
      ) : null}
    </div>
  );
}

function OriginBadge({ origin }: { origin: SampleSource["origin"] }) {
  if (origin === "none") return <span className="text-[10px] text-faint">no data</span>;
  const pinned = origin === "pinned";
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide"
      style={{
        color: pinned ? "#e0a33e" : "#34d0a8",
        background: pinned ? "rgba(224,163,62,0.12)" : "rgba(52,208,168,0.12)",
      }}
    >
      {pinned ? "pinned" : "last run"}
    </span>
  );
}

/**
 * Renders one value in the data tree. Objects/arrays expand into their children;
 * leaves show a preview. Every row is clickable and inserts the reference for its
 * own path. `path` here is the full dotted reference (without braces), e.g.
 * `trigger.user.email` or `node_x.body.0.id`.
 */
function ValueNode({
  label,
  path,
  value,
  onPick,
  depth,
}: {
  label: string;
  path: string;
  value: unknown;
  onPick: (ref: string) => void;
  depth: number;
}) {
  const isObject = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 1);

  if (!isObject) {
    return (
      <Row label={label} path={path} onPick={onPick}>
        <span className="ml-2 truncate font-mono text-[11px] text-faint">{leafPreview(value)}</span>
      </Row>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <Row label={label} path={path} onPick={onPick} onToggle={() => setOpen((v) => !v)} open={open} expandable>
        <span className="ml-2 font-mono text-[11px] text-faint">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </Row>
      {open ? (
        <div className="ml-3 border-l border-white/8 pl-1">
          {entries.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-faint">empty</p>
          ) : (
            entries.map(([key, child]) => (
              <ValueNode key={key} label={key} path={`${path}.${key}`} value={child} onPick={onPick} depth={depth + 1} />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  path,
  onPick,
  children,
  onToggle,
  open,
  expandable,
}: {
  label: string;
  path: string;
  onPick: (ref: string) => void;
  children?: React.ReactNode;
  onToggle?: () => void;
  open?: boolean;
  expandable?: boolean;
}) {
  return (
    <div className="group flex items-center rounded-md px-2 py-1 hover:bg-white/5">
      {expandable ? (
        <button type="button" onClick={onToggle} className="mr-1 shrink-0 text-faint" aria-label={open ? "Collapse" : "Expand"}>
          <ChevronRightIcon className="text-[11px] transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
        </button>
      ) : (
        <span className="mr-1 inline-block w-3 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => onPick(`{{ ${path} }}`)}
        className="flex min-w-0 flex-1 items-center text-left"
        title={`Insert {{ ${path} }}`}
      >
        <span className="truncate font-mono text-[11.5px] text-accent-bright group-hover:text-accent">{label}</span>
        {children}
      </button>
    </div>
  );
}

function leafPreview(value: unknown): string {
  const text = formatValue(value);
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}
