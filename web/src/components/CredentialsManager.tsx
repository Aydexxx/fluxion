import { useEffect, useMemo, useState } from "react";
import { credentialApi, errorMessage } from "../lib/api";
import type { Credential, CredentialTypeSpec } from "../lib/types";
import { useToast } from "./ui/toast";
import { confirm } from "./ui/confirm";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { FieldShell, Label, Select, TextInput } from "./Field";
import { KeyIcon, PlusIcon, TrashIcon } from "./icons";

interface Props {
  open: boolean;
  workspaceId: string | null;
  onClose: () => void;
}

/**
 * Per-workspace credential vault UI. Lists stored credentials (metadata only —
 * secrets never leave the server) and lets a member add, edit, or delete them.
 * The fields shown per type come from the backend's credential type catalog.
 */
export function CredentialsManager({ open, workspaceId, onClose }: Props) {
  const toast = useToast();
  const [types, setTypes] = useState<CredentialTypeSpec[] | null>(null);
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [editing, setEditing] = useState<Credential | "new" | null>(null);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let alive = true;
    void (async () => {
      try {
        const [t, list] = await Promise.all([
          types ? Promise.resolve(types) : credentialApi.types(),
          credentialApi.list(workspaceId),
        ]);
        if (!alive) return;
        setTypes(t);
        setCreds(list);
        setEditing(null); // always reopen on the list view
      } catch (err) {
        if (alive) toast.error(errorMessage(err, "Could not load credentials"));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

  const refresh = async () => {
    if (!workspaceId) return;
    try {
      setCreds(await credentialApi.list(workspaceId));
    } catch (err) {
      toast.error(errorMessage(err, "Could not refresh credentials"));
    }
  };

  const requestDelete = async (cred: Credential) => {
    const ok = await confirm({
      title: "Delete credential?",
      body: (
        <>
          <span className="text-ink">{cred.name}</span> will be permanently removed. Nodes that reference it will fail
          until reconfigured.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await credentialApi.remove(cred.id);
      toast.success("Credential deleted");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete credential"));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="md" aria-label="Credentials">
      <DialogHeader
        icon={<KeyIcon />}
        title="Credentials"
        description="Encrypted secrets for this workspace"
      />
      {editing && types ? (
        <CredentialForm
          types={types}
          workspaceId={workspaceId as string}
          existing={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : (
        <DialogBody>
          <CredentialList
            creds={creds}
            types={types}
            onAdd={() => setEditing("new")}
            onEdit={(c) => setEditing(c)}
            onDelete={requestDelete}
          />
        </DialogBody>
      )}
    </Dialog>
  );
}

function typeLabel(types: CredentialTypeSpec[] | null, type: string): string {
  return types?.find((t) => t.type === type)?.label ?? type;
}

function CredentialList({
  creds,
  types,
  onAdd,
  onEdit,
  onDelete,
}: {
  creds: Credential[] | null;
  types: CredentialTypeSpec[] | null;
  onAdd: () => void;
  onEdit: (c: Credential) => void;
  onDelete: (c: Credential) => void;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/12 px-3 py-2.5 text-[13px] font-medium text-accent-bright transition-colors hover:border-accent/40 hover:bg-accent/8"
      >
        <PlusIcon className="text-[15px]" /> Add credential
      </button>

      {creds === null ? (
        <p className="py-6 text-center text-[13px] text-muted">Loading…</p>
      ) : creds.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">No credentials yet. Add one to use in Email, Slack, Database or AI nodes.</p>
      ) : (
        <ul className="space-y-2">
          {creds.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-xl border border-white/8 bg-surface/50 px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-ink">{c.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-faint">
                  <span className="rounded bg-white/6 px-1.5 py-0.5 text-muted">{typeLabel(types, c.type)}</span>
                  {c.last4 ? <span className="font-mono">••••{c.last4}</span> : null}
                  {Object.entries(c.meta)
                    .slice(0, 1)
                    .map(([k, v]) => (
                      <span key={k} className="truncate font-mono">
                        {k}: {v}
                      </span>
                    ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEdit(c)}
                className="rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
              >
                Edit
              </button>
              <button
                type="button"
                aria-label="Delete credential"
                onClick={() => onDelete(c)}
                className="rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-300"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CredentialForm({
  types,
  workspaceId,
  existing,
  onCancel,
  onSaved,
}: {
  types: CredentialTypeSpec[];
  workspaceId: string;
  existing: Credential | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [type, setType] = useState(existing?.type ?? types[0]?.type ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  // Field inputs keyed by field key; non-secret fields prefill from meta on edit.
  const [fields, setFields] = useState<Record<string, string>>(() => ({ ...(existing?.meta ?? {}) }));
  const [saving, setSaving] = useState(false);

  const spec = useMemo(() => types.find((t) => t.type === type), [types, type]);
  const isEdit = existing !== null;

  // Reset field inputs when switching type (create flow only).
  const changeType = (next: string) => {
    setType(next);
    setFields({});
  };

  const set = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!spec) return;
    if (name.trim() === "") {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const data: Record<string, string> = {};
      for (const field of spec.fields) {
        const v = (fields[field.key] ?? "").trim();
        if (v !== "") data[field.key] = v;
      }
      const enteredSecret = spec.fields.some((f) => f.secret && (fields[f.key] ?? "").trim() !== "");

      if (isEdit) {
        // Only send data when the user (re-)entered a secret; otherwise rename only.
        await credentialApi.update(existing.id, { name: name.trim(), data: enteredSecret ? data : undefined });
        toast.success("Credential updated");
      } else {
        await credentialApi.create({ workspaceId, name: name.trim(), type, data });
        toast.success("Credential created");
      }
      await onSaved();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save credential"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogBody>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <FieldShell label="Type">
              <Select value={type} onChange={(e) => changeType(e.target.value)} disabled={isEdit}>
                {types.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </FieldShell>
            <FieldShell label="Name">
              <TextInput placeholder="e.g. Production mailer" value={name} onChange={(e) => setName(e.target.value)} />
            </FieldShell>
          </div>

          {spec?.blurb ? <p className="-mt-1 text-[11.5px] text-faint">{spec.blurb}</p> : null}

          <div className="space-y-3">
            {spec?.fields.map((field) => (
              <div key={field.key}>
                <Label>
                  {field.label}
                  {field.secret ? <span className="ml-1.5 text-faint">(secret)</span> : null}
                  {field.optional ? <span className="ml-1.5 text-faint">(optional)</span> : null}
                </Label>
                <TextInput
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  placeholder={field.secret && isEdit ? "•••• leave blank to keep" : field.placeholder}
                  value={fields[field.key] ?? ""}
                  onChange={(e) => set(field.key, e.target.value)}
                />
              </div>
            ))}
          </div>

          {isEdit ? (
            <p className="text-[11.5px] leading-relaxed text-faint">
              Secrets are write-only — they’re never shown. Leave secret fields blank to keep the current value, or
              re-enter them to rotate.
            </p>
          ) : null}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} loading={saving}>
          {isEdit ? "Save changes" : "Create credential"}
        </Button>
      </DialogFooter>
    </>
  );
}
