import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "./editorStore";
import { buildSampleScope } from "./sampleData";
import { DataPicker } from "./DataPicker";
import {
  formatValue,
  insertReference,
  parseSegments,
  previewExpression,
  resolvePath,
  type Scope,
} from "./references";
import { BoltIcon } from "../components/icons";

interface ExpressionInputProps {
  nodeId: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  /** Single-line fields (URL, subject…) suppress Enter newlines and default to one row. */
  singleLine?: boolean;
  ariaLabel?: string;
}

const FIELD_FONT = "font-mono text-[13px] leading-relaxed";
// Matched padding/whitespace so the highlight mirror lines up with the textarea.
const BOX = `${FIELD_FONT} w-full whitespace-pre-wrap break-words px-3 py-2 pr-9`;

/**
 * Text field that understands `{{ reference }}` tokens. It renders inserted
 * references as inline chips (over a transparent textarea), exposes a data picker
 * to insert references from upstream sample data at the caret, and shows a live
 * preview of the resolved value. A drop-in replacement for the plain Field
 * inputs wherever a value may contain references.
 */
export function ExpressionInput({
  nodeId,
  value,
  onChange,
  placeholder,
  rows,
  singleLine,
  ariaLabel,
}: ExpressionInputProps) {
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const activeRun = useEditor((s) => s.activeRun);

  const { scope, sources } = useMemo(
    () => buildSampleScope(nodes, edges, activeRun, nodeId),
    [nodes, edges, activeRun, nodeId],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
  const pendingCaret = useRef<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const segments = useMemo(() => parseSegments(value), [value]);
  const preview = useMemo(() => previewExpression(value, scope), [value, scope]);

  // Keep the mirror scrolled in lockstep with the textarea.
  const syncScroll = () => {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop;
      mirrorRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const rememberSelection = () => {
    const el = textareaRef.current;
    if (el) selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  // Restore the caret after a programmatic insert (value changes via onChange).
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && textareaRef.current) {
      const pos = pendingCaret.current;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
      selectionRef.current = { start: pos, end: pos };
      pendingCaret.current = null;
      syncScroll();
    }
  }, [value]);

  // Close the picker on Escape, anywhere.
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const handlePick = (ref: string) => {
    const { start, end } = selectionRef.current;
    const path = ref.replace(/^\{\{\s*|\s*\}\}$/g, "");
    const { value: next, cursor } = insertReference(value, start, end, path);
    pendingCaret.current = cursor;
    onChange(next);
    setPickerOpen(false);
  };

  return (
    <div className="relative">
      <div
        className="group relative rounded-lg border border-white/8 bg-void/60 transition-colors focus-within:border-accent/70 focus-within:bg-void/80"
      >
        {/* Highlight mirror — sits above the transparent textarea; only chips take pointer events. */}
        <div ref={mirrorRef} aria-hidden className={`pointer-events-none absolute inset-0 z-20 overflow-hidden text-ink ${BOX}`}>
          {value.length === 0 ? (
            <span className="text-faint">{placeholder}</span>
          ) : (
            segments.map((seg, i) =>
              seg.type === "text" ? (
                <span key={i}>{seg.text}</span>
              ) : (
                <Chip key={i} path={seg.path} text={seg.text} scope={scope} />
              ),
            )
          )}
          {/* Trailing newline guard so the mirror's height matches the textarea. */}
          {value.endsWith("\n") ? <span>{"​"}</span> : null}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          rows={rows ?? (singleLine ? 1 : 3)}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onClick={rememberSelection}
          onBlur={rememberSelection}
          onKeyDown={(e) => {
            if (singleLine && e.key === "Enter") e.preventDefault();
          }}
          className={`relative z-10 block resize-none border-0 bg-transparent text-transparent outline-none ${BOX}`}
          style={{ caretColor: "var(--color-ink)" }}
        />

        {/* Data picker toggle */}
        <button
          type="button"
          aria-label="Insert data reference"
          title="Insert data from an upstream node"
          // Don't steal focus from the textarea (keeps the caret position live).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            rememberSelection();
            setPickerOpen((v) => !v);
          }}
          className="absolute right-1.5 top-1.5 z-30 flex size-6 items-center justify-center rounded-md border border-white/8 bg-surface/80 text-faint transition-colors hover:border-accent/40 hover:text-accent-bright"
        >
          <BoltIcon className="text-[13px]" />
        </button>

        {pickerOpen ? (
          <DataPicker sources={sources} onPick={handlePick} onClose={() => setPickerOpen(false)} />
        ) : null}
      </div>

      {preview.hasReference ? <PreviewLine text={preview.text} hasMissing={preview.hasMissing} /> : null}
    </div>
  );
}

function Chip({ path, text, scope }: { path: string; text: string; scope: Scope }) {
  const resolved = resolvePath(scope, path);
  const missing = resolved === undefined;
  return (
    <span
      className="pointer-events-auto rounded px-1 py-px font-medium ring-1 transition-colors"
      style={{
        color: missing ? "#f0a3a3" : "var(--color-accent-bright)",
        background: missing ? "rgba(240,120,120,0.10)" : "color-mix(in oklab, var(--color-accent) 16%, transparent)",
        boxShadow: missing
          ? "inset 0 0 0 1px rgba(240,120,120,0.35)"
          : "inset 0 0 0 1px color-mix(in oklab, var(--color-accent) 32%, transparent)",
      }}
      title={missing ? `${path} — no sample data` : `${path} = ${formatValue(resolved)}`}
    >
      {text}
    </span>
  );
}

function PreviewLine({ text, hasMissing }: { text: string; hasMissing: boolean }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 px-0.5">
      <span className="mt-px shrink-0 text-[11px] text-faint">→</span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px]"
        style={{ color: hasMissing ? "#caa86a" : "var(--color-muted)" }}
        title={text}
      >
        {text === "" ? "(empty)" : text}
        {hasMissing ? <span className="ml-1.5 text-faint">· some references have no sample data</span> : null}
      </span>
    </div>
  );
}
