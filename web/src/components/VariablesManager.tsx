import { useEffect, useState } from "react";
import { variableApi, secretApi, errorMessage } from "../lib/api";
import type { WorkspaceVariable, WorkspaceSecret } from "../lib/types";
import { useToast } from "./ui/toast";
import { confirm } from "./ui/confirm";
import { Dialog, DialogBody, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Label, TextInput } from "./Field";
import { BracesIcon, KeyIcon, PlusIcon, TrashIcon } from "./icons";

interface Props {
  open: boolean;
  workspaceId: string | null;
  /** Editor+ may add/edit. */
  canEdit?: boolean;
  /** Admin+ may delete (mirrors credentials). */
  canManage?: boolean;
  onClose: () => void;
}

/**
 * Workspace settings surface for reusable VARIABLES (plain) and SECRETS
 * (encrypted, write-only). Reference them in any node config via
 * `{{ vars.KEY }}` / `{{ secrets.KEY }}`. Secrets' values are never shown — they
 * can only be set or rotated.
 */
export function VariablesManager({ open, workspaceId, canEdit = true, canManage = true, onClose }: Props) {
  const toast = useToast();
  const [variables, setVariables] = useState<WorkspaceVariable[] | null>(null);
  const [secrets, setSecrets] = useState<WorkspaceSecret[] | null>(null);

  const load = async () => {
    if (!workspaceId) return;
    try {
      const [v, s] = await Promise.all([variableApi.list(workspaceId), secretApi.list(workspaceId)]);
      setVariables(v);
      setSecrets(s);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load variables"));
    }
  };

  useEffect(() => {
    if (!open || !workspaceId) return;
    let alive = true;
    void (async () => {
      try {
        const [v, s] = await Promise.all([variableApi.list(workspaceId), secretApi.list(workspaceId)]);
        if (!alive) return;
        setVariables(v);
        setSecrets(s);
      } catch (err) {
        if (alive) toast.error(errorMessage(err, "Could not load variables"));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  return (
    <Dialog open={open} onClose={onClose} size="lg" aria-label="Variables and secrets">
      <DialogHeader
        icon={<BracesIcon />}
        title="Variables & Secrets"
        description="Reusable values for node configs — reference with {{ vars.KEY }} and {{ secrets.KEY }}"
      />
      <DialogBody className="space-y-6">
        <Section
          kind="variable"
          icon={<BracesIcon />}
          title="Variables"
          blurb="Plain, non-secret values like a base URL or account id. Referenced via {{ vars.KEY }}."
          rows={variables}
          canEdit={canEdit}
          canManage={canManage}
          workspaceId={workspaceId}
          onChanged={load}
        />
        <Section
          kind="secret"
          icon={<KeyIcon />}
          title="Secrets"
          blurb="Encrypted at rest; values are never shown. Referenced via {{ secrets.KEY }}."
          rows={secrets}
          canEdit={canEdit}
          canManage={canManage}
          workspaceId={workspaceId}
          onChanged={load}
        />
      </DialogBody>
    </Dialog>
  );
}

type Row = WorkspaceVariable | WorkspaceSecret;

function Section({
  kind,
  icon,
  title,
  blurb,
  rows,
  canEdit,
  canManage,
  workspaceId,
  onChanged,
}: {
  kind: "variable" | "secret";
  icon: React.ReactNode;
  title: string;
  blurb: string;
  rows: Row[] | null;
  canEdit: boolean;
  canManage: boolean;
  workspaceId: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const toast = useToast();
  const isSecret = kind === "secret";
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const requestDelete = async (row: Row) => {
    const ok = await confirm({
      title: `Delete ${kind} "${row.key}"?`,
      body: (
        <>
          Nodes referencing <span className="font-mono text-ink">{`{{ ${isSecret ? "secrets" : "vars"}.${row.key} }}`}</span>{" "}
          will resolve to nothing until reconfigured.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      if (isSecret) await secretApi.remove(row.id);
      else await variableApi.remove(row.id);
      toast.success(`${title.slice(0, -1)} deleted`);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete"));
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent/12 text-[13px] text-accent">
          {icon}
        </span>
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
        {rows ? <span className="text-[11.5px] text-faint">· {rows.length}</span> : null}
      </div>
      <p className="mb-2.5 text-[11.5px] leading-relaxed text-faint">{blurb}</p>

      {rows === null ? (
        <p className="py-3 text-center text-[12.5px] text-muted">Loading…</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) =>
            editingId === row.id && canEdit ? (
              <RowForm
                key={row.id}
                kind={kind}
                existing={row}
                workspaceId={workspaceId}
                onCancel={() => setEditingId(null)}
                onSaved={async () => {
                  setEditingId(null);
                  await onChanged();
                }}
              />
            ) : (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-white/8 bg-surface/50 px-3 py-2"
              >
                <code className="shrink-0 rounded bg-white/6 px-1.5 py-0.5 font-mono text-[12px] text-accent-bright">
                  {row.key}
                </code>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-faint">
                  {isSecret ? "••••••••" : (row as WorkspaceVariable).value}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setEditingId(row.id)}
                    className="rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
                  >
                    {isSecret ? "Rotate" : "Edit"}
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    aria-label={`Delete ${kind} ${row.key}`}
                    onClick={() => void requestDelete(row)}
                    className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-300"
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </li>
            ),
          )}

          {adding && canEdit ? (
            <RowForm
              kind={kind}
              existing={null}
              workspaceId={workspaceId}
              onCancel={() => setAdding(false)}
              onSaved={async () => {
                setAdding(false);
                await onChanged();
              }}
            />
          ) : canEdit ? (
            <li>
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/12 px-3 py-2 text-[12.5px] font-medium text-accent-bright transition-colors hover:border-accent/40 hover:bg-accent/8"
              >
                <PlusIcon className="text-[14px]" /> Add {kind}
              </button>
            </li>
          ) : rows.length === 0 ? (
            <li className="py-2 text-center text-[12px] text-faint">None yet.</li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function RowForm({
  kind,
  existing,
  workspaceId,
  onCancel,
  onSaved,
}: {
  kind: "variable" | "secret";
  existing: Row | null;
  workspaceId: string | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const isSecret = kind === "secret";
  const isEdit = existing !== null;
  const [key, setKey] = useState(existing?.key ?? "");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!workspaceId) return;
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      toast.error("Key is required");
      return;
    }
    // A new secret needs a value; editing a secret may rename only (blank = keep).
    if (isSecret && !isEdit && value.trim() === "") {
      toast.error("Secret value is required");
      return;
    }
    if (!isSecret && value === "" && !isEdit) {
      // A variable may legitimately be empty; only block on create if you want a value.
    }
    setSaving(true);
    try {
      if (isSecret) {
        const valuePatch = value.trim() === "" ? undefined : value;
        if (isEdit) await secretApi.update(existing.id, { key: trimmedKey, value: valuePatch });
        else await secretApi.create(workspaceId, { key: trimmedKey, value });
      } else {
        if (isEdit) await variableApi.update(existing.id, { key: trimmedKey, value });
        else await variableApi.create(workspaceId, { key: trimmedKey, value });
      }
      toast.success(isEdit ? "Saved" : `${isSecret ? "Secret" : "Variable"} added`);
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="rounded-lg border border-accent/30 bg-accent/[0.04] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:w-40">
          <Label>Key</Label>
          <TextInput
            value={key}
            autoFocus={!isEdit}
            placeholder="BASE_URL"
            onChange={(e) => setKey(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="flex-1">
          <Label>{isSecret && isEdit ? "New value (leave blank to keep)" : "Value"}</Label>
          <TextInput
            type={isSecret ? "password" : "text"}
            autoComplete="off"
            value={value}
            placeholder={isSecret ? (isEdit ? "•••• leave blank to keep" : "Secret value") : "Value"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            {isEdit ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </li>
  );
}
