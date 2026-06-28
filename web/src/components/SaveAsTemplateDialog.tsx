import { useState } from "react";
import { templateApi, errorMessage } from "../lib/api";
import type { UserTemplate } from "../lib/types";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Label, TextArea, TextInput } from "./Field";
import { useToast } from "./ui/toast";
import { LayersIcon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The workflow whose current draft is captured. */
  workflowId: string | null;
  /** Pre-fills the template name (usually the workflow's name). */
  defaultName: string;
  /** Called after a successful save, e.g. to refresh a gallery. */
  onSaved?: (template: UserTemplate) => void;
}

/**
 * Captures a workflow as a reusable workspace template. Shared by the workflow
 * card action and the editor top bar. The server reads the workflow's saved
 * draft and strips credential bindings, so secrets never travel into a template.
 */
export function SaveAsTemplateDialog({ open, onClose, workflowId, defaultName, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset the form each time the dialog opens, adjusting state during render
  // (React's documented pattern) rather than in an effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setName(defaultName);
    setDescription("");
    setSaving(false);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const submit = async () => {
    if (!workflowId || !name.trim() || saving) return;
    setSaving(true);
    try {
      const template = await templateApi.createCustom({
        workflowId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      toast.success("Saved to My Templates");
      onSaved?.(template);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save template"));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="sm">
      <DialogHeader
        title="Save as template"
        description="Reuse this workflow across your workspace. Credentials are not included."
        icon={<LayersIcon />}
      />
      <DialogBody>
        <div className="space-y-4">
          <div>
            <Label htmlFor="tpl-name">Template name</Label>
            <TextInput
              id="tpl-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer onboarding"
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          <div>
            <Label htmlFor="tpl-desc">Description</Label>
            <TextArea
              id="tpl-desc"
              value={description}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this template do? (optional)"
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} loading={saving} disabled={!name.trim() || !workflowId}>
          Save template
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
