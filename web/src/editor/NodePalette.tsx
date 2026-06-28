import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useReactFlow } from "@xyflow/react";
import { CATEGORIES, CATEGORY_ORDER, NODE_SPEC_LIST, matchesSpec, type NodeSpec } from "./nodeCatalog";
import { useEditor } from "./editorStore";
import { DRAG_MIME } from "./dragMime";
import { riseIn, stagger, still } from "../lib/motion";
import { CloseIcon, SearchIcon } from "../components/icons";

export function NodePalette() {
  const reduce = useReducedMotion();
  const addNodeAt = useEditor((s) => s.addNodeAt);
  const reactFlow = useReactFlow();
  const [query, setQuery] = useState("");

  const addToCenter = (type: string) => {
    const position = reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    addNodeAt(type, { x: position.x - 114, y: position.y - 37 });
  };

  const filtered = useMemo(() => NODE_SPEC_LIST.filter((s) => matchesSpec(s, query)), [query]);
  const visibleCategories = CATEGORY_ORDER.filter((catId) => filtered.some((s) => s.category === catId));

  return (
    <aside
      data-tour="node-palette"
      className="flex h-full w-[264px] shrink-0 flex-col border-r border-white/8 bg-surface/40 backdrop-blur-xl"
    >
      <div className="px-5 pb-3 pt-5">
        <h2 className="font-display text-[13px] font-semibold tracking-wide text-ink">Node library</h2>
        <p className="mt-0.5 text-[12px] text-faint">Drag onto the canvas, or click to drop in.</p>
      </div>

      <div className="px-3 pb-2">
        <div className="group flex items-center gap-2 rounded-lg border border-white/8 bg-void/50 px-2.5 transition-colors focus-within:border-accent/60">
          <SearchIcon className="shrink-0 text-[14px] text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            spellCheck={false}
            aria-label="Search nodes"
            className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-ink outline-none placeholder:text-faint"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-ink"
            >
              <CloseIcon className="text-[13px]" />
            </button>
          ) : null}
        </div>
      </div>

      <motion.div
        key={query === "" ? "all" : "filtered"}
        variants={reduce ? still : stagger(0.05, 0.04)}
        initial="hidden"
        animate="show"
        className="flex-1 space-y-5 overflow-y-auto px-3 pb-6"
      >
        {visibleCategories.length === 0 ? (
          <p className="px-2 pt-6 text-center text-[12.5px] text-faint">
            No nodes match “<span className="text-muted">{query}</span>”.
          </p>
        ) : (
          visibleCategories.map((catId) => {
            const cat = CATEGORIES[catId];
            const specs = filtered.filter((s) => s.category === catId);
            return (
              <div key={catId}>
                <div className="flex items-center gap-2 px-2 pb-2">
                  <span className="size-1.5 rounded-full" style={{ background: cat.accent }} />
                  <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted">{cat.label}</span>
                </div>
                <div className="space-y-1.5">
                  {specs.map((spec) => (
                    <PaletteItem key={spec.type} spec={spec} reduce={!!reduce} onAdd={() => addToCenter(spec.type)} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </motion.div>
    </aside>
  );
}

function PaletteItem({ spec, reduce, onAdd }: { spec: NodeSpec; reduce: boolean; onAdd: () => void }) {
  const Icon = spec.icon;
  const accent = CATEGORIES[spec.category].accent;

  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData(DRAG_MIME, spec.type);
    event.dataTransfer.effectAllowed = "copy";
  };

  // Native HTML5 drag lives on a plain <button>; framer-motion reserves
  // onDragStart for its own gesture system, so we keep motion on the wrapper.
  return (
    <motion.div variants={reduce ? still : riseIn} whileTap={reduce ? undefined : { scale: 0.98 }}>
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onClick={onAdd}
        className="group flex w-full cursor-grab items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left transition-colors duration-200 hover:border-white/8 hover:bg-white/[0.03] active:cursor-grabbing"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] text-[16px] transition-transform duration-200 group-hover:scale-105"
          style={{
            color: accent,
            background: `color-mix(in oklab, ${accent} 14%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 26%, transparent)`,
          }}
        >
          <Icon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{spec.label}</span>
          <span className="block truncate text-[11.5px] text-faint">{spec.blurb}</span>
        </span>
      </button>
    </motion.div>
  );
}
