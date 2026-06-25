import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import { useReducedMotion } from "framer-motion";
import { useEditor } from "./editorStore";
import { useToast } from "../components/ui/toast";

/** True when the event originates from a text input, so we don't hijack typing. */
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global editor keyboard layer. Mounted once inside the ReactFlow provider.
 * Owns undo/redo, clipboard, selection, deletion, save, fit-view, the command
 * palette and the shortcuts overlay. Typing in inputs is never hijacked, except
 * for the always-on Save and Command-palette chords.
 */
export function useEditorShortcuts() {
  const reduce = useReducedMotion();
  const reactFlow = useReactFlow();
  const toast = useToast();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const lower = key.toLowerCase();
      const store = useEditor.getState();
      const editable = isEditable(e.target);

      // ── Always available, even while typing ─────────────────────────────
      if (mod && lower === "k") {
        e.preventDefault();
        store.setCommandPaletteOpen(!store.commandPaletteOpen);
        return;
      }
      if (mod && lower === "s") {
        e.preventDefault();
        void save(toast);
        return;
      }

      // Don't fight the browser/input while editing text, and don't let canvas
      // edits leak through while a modal overlay owns the screen.
      const overlayOpen = store.commandPaletteOpen || store.shortcutsOpen || store.credentialsManagerOpen;
      if (editable || overlayOpen) return;

      // ── Undo / redo ─────────────────────────────────────────────────────
      if (mod && lower === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if ((mod && lower === "z" && e.shiftKey) || (mod && lower === "y")) {
        e.preventDefault();
        store.redo();
        return;
      }

      // ── Clipboard / duplicate ───────────────────────────────────────────
      if (mod && lower === "c") {
        store.copySelection();
        return;
      }
      if (mod && lower === "v") {
        store.pasteClipboard();
        return;
      }
      if (mod && lower === "d") {
        e.preventDefault();
        store.duplicateSelection();
        return;
      }

      // ── Selection ───────────────────────────────────────────────────────
      if (mod && lower === "a") {
        e.preventDefault();
        store.selectAll();
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        e.preventDefault();
        store.deleteSelection();
        return;
      }

      // ── View / help (single keys, no modifier) ──────────────────────────
      if (!mod && lower === "f") {
        e.preventDefault();
        reactFlow.fitView({ padding: 0.3, duration: reduce ? 0 : 500, maxZoom: 1.1 });
        return;
      }
      if (!mod && (key === "?" || (e.shiftKey && key === "/"))) {
        e.preventDefault();
        store.setShortcutsOpen(!store.shortcutsOpen);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reactFlow, reduce, toast]);
}

async function save(toast: ReturnType<typeof useToast>) {
  const res = await useEditor.getState().save();
  if (!res.ok) {
    toast.error(res.message ?? "Could not save");
    return;
  }
  toast.success("Workflow saved");
  for (const w of useEditor.getState().warnings.slice(0, 2)) toast.info(w);
}
