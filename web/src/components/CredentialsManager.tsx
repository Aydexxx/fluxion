import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { credentialApi, errorMessage } from "../lib/api";
import type { Credential, CredentialTypeSpec } from "../lib/types";
import { EASE } from "../lib/motion";
import { toast } from "../store/toasts";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldShell, Label, Select, TextInput } from "./Field";
import { CloseIcon, KeyIcon, PlusIcon, SpinnerIcon, TrashIcon } from "./icons";

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
  const reduce = useReducedMotion();
  const [types, setTypes] = useState<CredentialTypeSpec[] | null>(null);
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [editing, setEditing] = useState<Credential | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Credential | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await credentialApi.remove(pendingDelete.id);
      toast.success("Credential deleted");
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete credential"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Credentials"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="relative flex max-h-[82vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl glass"
            style={{ boxShadow: "0 30px 80px -30px rgba(0,0,0,0.85)" }}
          >
            <header className="flex items-center justify-between border-b border-white/8 p-4">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent/12 text-[16px] text-accent">
                  <KeyIcon />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Credentials</h2>
                  <p className="text-[11.5px] text-faint">Encrypted secrets for this workspace</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
              >
                <CloseIcon />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
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
                <CredentialList
                  creds={creds}
                  types={types}
                  onAdd={() => setEditing("new")}
                  onEdit={(c) => setEditing(c)}
                  onDelete={(c) => setPendingDelete(c)}
                />
              )}
            </div>
          </motion.div>

          <ConfirmDialog
            open={Boolean(pendingDelete)}
            title="Delete credential?"
            body={
              <>
                <span className="text-ink">{pendingDelete?.name}</span> will be permanently removed. Nodes that reference
                it will fail until reconfigured.
              </>
            }
            confirmLabel={deleting ? "Deleting…" : "Delete"}
            destructive
            busy={deleting}
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        </div>
      ) : null}
    </AnimatePresence>
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
          Secrets are write-only — they’re never shown. Leave secret fields blank to keep the current value, or re-enter
          them to rotate.
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/8 px-3.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))" }}
        >
          {saving ? <SpinnerIcon className="animate-spin text-[15px]" /> : null}
          {isEdit ? "Save changes" : "Create credential"}
        </button>
      </div>
    </div>
  );
}
