import { Dialog, DialogBody, DialogHeader } from "../components/ui/Dialog";
import { useEditor } from "./editorStore";
import { KeyboardIcon } from "../components/icons";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

interface Shortcut {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Essentials",
    items: [
      { keys: [MOD, "K"], label: "Command palette" },
      { keys: [MOD, "S"], label: "Save workflow" },
      { keys: ["?"], label: "This shortcuts panel" },
    ],
  },
  {
    title: "History",
    items: [
      { keys: [MOD, "Z"], label: "Undo" },
      { keys: [MOD, "⇧", "Z"], label: "Redo" },
      { keys: [MOD, "Y"], label: "Redo (alt)" },
    ],
  },
  {
    title: "Edit",
    items: [
      { keys: [MOD, "C"], label: "Copy selection" },
      { keys: [MOD, "V"], label: "Paste" },
      { keys: [MOD, "D"], label: "Duplicate selection" },
      { keys: [MOD, "A"], label: "Select all" },
      { keys: ["Del"], label: "Delete selection" },
    ],
  },
  {
    title: "Selection & view",
    items: [
      { keys: ["Shift", "Click"], label: "Add to selection" },
      { keys: ["Shift", "Drag"], label: "Marquee select" },
      { keys: ["F"], label: "Fit view" },
    ],
  },
];

/** Reference overlay for every editor keyboard interaction. Opened via "?" or the controls. */
export function ShortcutsHelp() {
  const open = useEditor((s) => s.shortcutsOpen);
  const setOpen = useEditor((s) => s.setShortcutsOpen);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} size="lg" aria-label="Keyboard shortcuts">
      <DialogHeader
        icon={<KeyboardIcon />}
        title="Keyboard shortcuts"
        description="Move fast — these work anywhere on the canvas"
      />
      <DialogBody>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
                {group.title}
              </div>
              <div className="space-y-1.5">
                {group.items.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-muted">{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-[22px] rounded-md border border-white/10 bg-void/50 px-1.5 py-0.5 text-center font-mono text-[11px] text-ink"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogBody>
    </Dialog>
  );
}
