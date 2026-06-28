import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useReactFlow } from "@xyflow/react";
import { useEditor } from "./editorStore";
import { NODE_SPEC_LIST, CATEGORIES, matchesSpec } from "./nodeCatalog";
import { workflowApi } from "../lib/api";
import type { WorkflowSummary } from "../lib/types";
import { navigate } from "../lib/router";
import { useToast } from "../components/ui/toast";
import { EASE } from "../lib/motion";
import {
  BracesIcon,
  FrameIcon,
  GridIcon,
  HistoryIcon,
  KeyIcon,
  KeyboardIcon,
  MagnetIcon,
  PlayIcon,
  SaveIcon,
  SearchIcon,
} from "../components/icons";
import type { ComponentType, SVGProps } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  icon: IconType;
  keywords?: string;
  /** Tint for the icon chip (defaults to the accent). */
  tint?: string;
  run: () => void | Promise<void>;
}

/** Cmd/Ctrl+K quick actions: run/save, navigation, add-node, jump to a workflow. */
export function CommandPalette() {
  const reduce = useReducedMotion();
  const open = useEditor((s) => s.commandPaletteOpen);
  const setOpen = useEditor((s) => s.setCommandPaletteOpen);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[115] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
          />
          <PaletteBody reduce={!!reduce} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Mounted only while the palette is open, so its query/selection state is fresh
 * each time and no reset effects are needed.
 */
function PaletteBody({ reduce, onClose }: { reduce: boolean; onClose: () => void }) {
  const toast = useToast();
  const reactFlow = useReactFlow();
  const workspaceId = useEditor((s) => s.workspaceId);
  const snap = useEditor((s) => s.snapToGrid);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the input and load the workflow list on mount (i.e. each open).
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 20);
    if (workspaceId) {
      workflowApi
        .list(workspaceId)
        .then(setWorkflows)
        .catch(() => {});
    }
    return () => clearTimeout(id);
  }, [workspaceId]);

  const addNodeAtCenter = (type: string) => {
    const p = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    useEditor.getState().addNodeAt(type, { x: p.x - 114, y: p.y - 37 });
  };

  const runWorkflow = async () => {
    const id = toast.loading("Starting run…");
    const res = await useEditor.getState().run();
    if (!res.ok) toast.update(id, { kind: "error", message: res.message ?? "Could not run workflow" });
    else toast.update(id, { kind: "info", message: "Run queued" });
  };

  const saveWorkflow = async () => {
    const res = await useEditor.getState().save();
    if (!res.ok) toast.error(res.message ?? "Could not save");
    else toast.success("Workflow saved");
  };

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      { id: "run", title: "Run workflow", group: "Actions", icon: PlayIcon, keywords: "execute start play", run: runWorkflow },
      { id: "save", title: "Save workflow", group: "Actions", icon: SaveIcon, keywords: "persist", run: saveWorkflow },
      {
        id: "fit",
        title: "Fit view",
        group: "Actions",
        icon: FrameIcon,
        keywords: "zoom center frame",
        run: () => reactFlow.fitView({ padding: 0.3, duration: reduce ? 0 : 500, maxZoom: 1.1 }),
      },
      {
        id: "snap",
        title: snap ? "Disable snapping" : "Enable snapping",
        group: "Actions",
        icon: MagnetIcon,
        keywords: "grid align",
        run: () => useEditor.getState().setSnapToGrid(!snap),
      },
      {
        id: "credentials",
        title: "Manage credentials",
        group: "Actions",
        icon: KeyIcon,
        keywords: "secrets vault keys",
        run: () => useEditor.getState().setCredentialsManagerOpen(true),
      },
      {
        id: "variables",
        title: "Manage variables & secrets",
        group: "Actions",
        icon: BracesIcon,
        keywords: "vars secrets environment config",
        run: () => useEditor.getState().setVariablesManagerOpen(true),
      },
      {
        id: "shortcuts",
        title: "Keyboard shortcuts",
        group: "Actions",
        icon: KeyboardIcon,
        keywords: "help keys",
        run: () => useEditor.getState().setShortcutsOpen(true),
      },
      {
        id: "go-runs",
        title: "Go to runs",
        group: "Navigate",
        icon: HistoryIcon,
        keywords: "history executions",
        run: () => navigate("/runs"),
      },
      {
        id: "go-workflows",
        title: "Go to workflows",
        group: "Navigate",
        icon: GridIcon,
        keywords: "dashboard home",
        run: () => navigate("/"),
      },
    ];

    for (const spec of NODE_SPEC_LIST) {
      const tint = CATEGORIES[spec.category].accent;
      cmds.push({
        id: `add:${spec.type}`,
        title: `Add ${spec.label}`,
        subtitle: spec.blurb,
        group: "Add node",
        icon: spec.icon,
        tint,
        keywords: `${spec.type} ${CATEGORIES[spec.category].label} insert create`,
        run: () => addNodeAtCenter(spec.type),
      });
    }

    for (const wf of workflows) {
      cmds.push({
        id: `open:${wf.id}`,
        title: wf.name || "Untitled workflow",
        subtitle: "Open workflow",
        group: "Open workflow",
        icon: GridIcon,
        keywords: "switch goto",
        run: () => navigate(`/workflows/${wf.id}`),
      });
    }

    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflows, snap, reduce]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return commands;
    return commands.filter((c) => {
      // Add-node commands reuse the catalog matcher for consistent behaviour.
      if (c.id.startsWith("add:")) {
        const spec = NODE_SPEC_LIST.find((s) => `add:${s.type}` === c.id);
        if (spec && matchesSpec(spec, q)) return true;
      }
      const hay = `${c.title} ${c.subtitle ?? ""} ${c.keywords ?? ""}`.toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [commands, query]);

  // Clamp at render rather than via an effect, so results shrinking is handled cleanly.
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

  // Keep the active row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const runCommand = (cmd: Command | undefined) => {
    if (!cmd) return;
    onClose();
    void cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(results[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Render with running indices so keyboard + group headers stay in sync.
  let runningIndex = -1;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="relative flex max-h-[60vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl glass"
      style={{ boxShadow: "0 40px 100px -30px rgba(0,0,0,0.9)" }}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-3 border-b border-white/8 px-4">
        <SearchIcon className="shrink-0 text-[17px] text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Type a command or search…"
          spellCheck={false}
          aria-label="Command palette search"
          className="min-w-0 flex-1 bg-transparent py-3.5 text-[14px] text-ink outline-none placeholder:text-faint"
        />
        <kbd className="hidden shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
          ESC
        </kbd>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-faint">No matching commands.</p>
        ) : (
          groupBy(results).map(([group, items]) => (
            <div key={group} className="mb-1">
              <div className="px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{group}</div>
              {items.map((cmd) => {
                runningIndex += 1;
                const index = runningIndex;
                const isActive = index === activeIndex;
                const Icon = cmd.icon;
                const tint = cmd.tint ?? "var(--color-accent)";
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => runCommand(cmd)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left"
                    style={{ background: isActive ? "color-mix(in oklab, white 6%, transparent)" : "transparent" }}
                  >
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[14px]"
                      style={{
                        color: tint,
                        background: `color-mix(in oklab, ${tint} 14%, transparent)`,
                        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tint} 24%, transparent)`,
                      }}
                    >
                      <Icon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] text-ink">{cmd.title}</span>
                      {cmd.subtitle ? <span className="block truncate text-[11.5px] text-faint">{cmd.subtitle}</span> : null}
                    </span>
                    {isActive ? (
                      <kbd className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-faint">
                        ↵
                      </kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}

/** Stable grouping that preserves first-seen group order. */
function groupBy(commands: Command[]): [string, Command[]][] {
  const map = new Map<string, Command[]>();
  for (const c of commands) {
    const list = map.get(c.group);
    if (list) list.push(c);
    else map.set(c.group, [c]);
  }
  return [...map.entries()];
}
