import { useState } from "react";
import type { Folder } from "../lib/types";
import { confirm } from "./ui/confirm";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Label, TextInput } from "./Field";
import { EditIcon, FolderIcon, PlusIcon, TrashIcon } from "./icons";

/** Sentinel passed as `activeFolderId` to mean "workflows with no folder". */
export const UNFILED = "none";

interface Props {
  folders: Folder[];
  /** null = "All", UNFILED = "Unfiled", else a folder id. */
  activeFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  canEdit: boolean;
  onCreate: (name: string) => Promise<void>;
  onRename: (folder: Folder, name: string) => Promise<void>;
  onDelete: (folder: Folder) => Promise<void>;
}

const chipBase =
  "group flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors";

/**
 * A horizontal, scrollable row of folder chips: "All", "Unfiled", then every
 * folder (with its workflow count). Deliberately flat — no nesting — so it
 * stays a simple, fast way to group a growing workflow list rather than a tree
 * to maintain. Create/rename/delete are gated on `canEdit`.
 */
export function FolderRail({ folders, activeFolderId, onSelect, canEdit, onCreate, onRename, onDelete }: Props) {
  const [dialog, setDialog] = useState<{ mode: "create" | "rename"; folder?: Folder } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setName("");
    setDialog({ mode: "create" });
  };

  const openRename = (folder: Folder) => {
    setName(folder.name);
    setDialog({ mode: "rename", folder });
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || !dialog) return;
    setBusy(true);
    try {
      if (dialog.mode === "create") await onCreate(trimmed);
      else if (dialog.folder) await onRename(dialog.folder, trimmed);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = async (folder: Folder) => {
    const ok = await confirm({
      title: `Delete "${folder.name}"?`,
      body:
        folder.workflowCount > 0
          ? `${folder.workflowCount} workflow${folder.workflowCount === 1 ? "" : "s"} will be un-filed, not deleted.`
          : "This folder is empty.",
      confirmLabel: "Delete folder",
      destructive: true,
    });
    if (!ok) return;
    if (activeFolderId === folder.id) onSelect(null);
    await onDelete(folder);
  };

  return (
    <>
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Folders">
        <button
          type="button"
          role="tab"
          aria-selected={activeFolderId === null}
          onClick={() => onSelect(null)}
          className={`${chipBase} ${
            activeFolderId === null ? "border-accent/50 bg-accent/15 text-ink" : "border-white/8 text-muted hover:border-white/14 hover:text-ink"
          }`}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFolderId === UNFILED}
          onClick={() => onSelect(UNFILED)}
          className={`${chipBase} ${
            activeFolderId === UNFILED ? "border-accent/50 bg-accent/15 text-ink" : "border-white/8 text-muted hover:border-white/14 hover:text-ink"
          }`}
        >
          Unfiled
        </button>

        {folders.map((folder) => {
          const active = activeFolderId === folder.id;
          return (
            <span
              key={folder.id}
              role="tab"
              aria-selected={active}
              className={`${chipBase} cursor-pointer ${
                active ? "border-accent/50 bg-accent/15 text-ink" : "border-white/8 text-muted hover:border-white/14 hover:text-ink"
              }`}
              onClick={() => onSelect(folder.id)}
            >
              <FolderIcon className="text-[13px]" />
              {folder.name}
              <span className="text-faint">{folder.workflowCount}</span>
              {canEdit ? (
                <span className="ml-0.5 hidden items-center gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    aria-label={`Rename ${folder.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openRename(folder);
                    }}
                    className="rounded p-0.5 hover:text-ink"
                  >
                    <EditIcon className="text-[11px]" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${folder.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void requestDelete(folder);
                    }}
                    className="rounded p-0.5 hover:text-danger"
                  >
                    <TrashIcon className="text-[11px]" />
                  </button>
                </span>
              ) : null}
            </span>
          );
        })}

        {canEdit ? (
          <button
            type="button"
            onClick={openCreate}
            className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-white/14 px-3 py-1.5 text-[12.5px] text-faint transition-colors hover:border-white/25 hover:text-ink"
          >
            <PlusIcon className="text-[12px]" /> New folder
          </button>
        ) : null}
      </div>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} size="sm">
        <DialogHeader title={dialog?.mode === "rename" ? "Rename folder" : "New folder"} icon={<FolderIcon />} />
        <DialogBody>
          <Label htmlFor="folder-name">Name</Label>
          <TextInput
            id="folder-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marketing"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!name.trim()}>
            {dialog?.mode === "rename" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
