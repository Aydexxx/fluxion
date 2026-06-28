import { useState } from "react";
import type { Folder, Tag, WorkflowSummary } from "../lib/types";
import { errorMessage, workflowApi } from "../lib/api";
import { useToast } from "./ui/toast";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Label, Select, TextInput } from "./Field";
import { FolderIcon, CloseIcon } from "./icons";
import { UNFILED } from "./FolderRail";

interface Props {
  workflow: WorkflowSummary | null;
  folders: Folder[];
  /** Known workspace tags, for lightweight autocomplete suggestions. */
  knownTags: Tag[];
  onClose: () => void;
  /** Called once the workflow is saved, so the caller can refresh its list. */
  onSaved: () => void;
}

/**
 * Small dialog to file a workflow into a folder and edit its tags, opened from
 * a card's "Organize" affordance. The form is only mounted while `workflow` is
 * set, so it always seeds fresh from that workflow without an effect (the same
 * pattern as the editor's FailureAlertDialog).
 */
export function WorkflowOrganizer({ workflow, folders, knownTags, onClose, onSaved }: Props) {
  return (
    <Dialog open={workflow !== null} onClose={onClose} size="sm">
      {workflow ? (
        <OrganizerForm workflow={workflow} folders={folders} knownTags={knownTags} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Dialog>
  );
}

function OrganizerForm({
  workflow,
  folders,
  knownTags,
  onClose,
  onSaved,
}: {
  workflow: WorkflowSummary;
  folders: Folder[];
  knownTags: Tag[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [folderId, setFolderId] = useState(workflow.folder?.id ?? UNFILED);
  const [tags, setTags] = useState(workflow.tags.map((t) => t.name));
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const addTag = (raw: string) => {
    const name = raw.trim().toLowerCase();
    if (!name || tags.includes(name)) return;
    if (tags.length >= 20) return;
    setTags((prev) => [...prev, name]);
    setTagInput("");
  };

  const removeTag = (name: string) => setTags((prev) => prev.filter((t) => t !== name));

  const save = async () => {
    setSaving(true);
    try {
      await workflowApi.update(workflow.id, { folderId: folderId === UNFILED ? null : folderId, tags });
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Could not update workflow"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader title="Organize" description={workflow.name} icon={<FolderIcon />} />
      <DialogBody className="space-y-4">
        <div>
          <Label htmlFor="organize-folder">Folder</Label>
          <Select id="organize-folder" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value={UNFILED}>Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="organize-tags">Tags</Label>
          {tags.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] capitalize text-ink"
                >
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    onClick={() => removeTag(t)}
                    className="text-faint transition-colors hover:text-danger"
                  >
                    <CloseIcon className="text-[10px]" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <TextInput
            id="organize-tags"
            list="workspace-tags"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Type a tag, press Enter"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag(tagInput);
              } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
                removeTag(tags[tags.length - 1]);
              }
            }}
          />
          <datalist id="workspace-tags">
            {knownTags.filter((t) => !tags.includes(t.name)).map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={saving}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
