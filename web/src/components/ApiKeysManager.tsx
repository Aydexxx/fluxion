import { useEffect, useState } from "react";
import { apiKeyApi, errorMessage } from "../lib/api";
import type { ApiKey, ApiScope, CreatedApiKey, Workspace } from "../lib/types";
import { canManageMembers } from "../lib/permissions";
import { useToast } from "./ui/toast";
import { confirm } from "./ui/confirm";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Label, TextInput } from "./Field";
import { CheckIcon, CopyIcon, KeyIcon, PlusIcon, TrashIcon } from "./icons";

interface Props {
  open: boolean;
  workspace: Workspace;
  onClose: () => void;
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const SCOPE_META: Record<ApiScope, { label: string; blurb: string }> = {
  "workflows:read": { label: "Read", blurb: "List & read workflows and runs" },
  "workflows:run": { label: "Run", blurb: "Trigger workflow runs" },
};
const ALL_SCOPES = Object.keys(SCOPE_META) as ApiScope[];

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Workspace settings surface for programmatic access: create scoped API keys
 * (the plaintext is shown once, right after creation), see active keys with
 * their scopes + last use, revoke them, and read a minimal API reference. All
 * mutating controls are admin-gated client-side; the server re-checks.
 */
export function ApiKeysManager({ open, workspace, onClose }: Props) {
  const toast = useToast();
  const canManage = canManageMembers(workspace.role);

  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["workflows:read"]);
  const [creating, setCreating] = useState(false);
  // The just-created key's plaintext — shown once, then forgotten on close/dismiss.
  const [revealed, setRevealed] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      setKeys(await apiKeyApi.list(workspace.id));
    } catch (err) {
      toast.error(errorMessage(err, "Could not load API keys"));
    }
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const data = await apiKeyApi.list(workspace.id);
        if (alive) setKeys(data);
      } catch (err) {
        if (alive) toast.error(errorMessage(err, "Could not load API keys"));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace.id]);

  // Forget any revealed secret (and reset the form) on close — it's shown once only.
  const close = () => {
    setRevealed(null);
    setName("");
    setScopes(["workflows:read"]);
    onClose();
  };

  const toggleScope = (scope: ApiScope, on: boolean) =>
    setScopes((prev) => (on ? [...new Set([...prev, scope])] : prev.filter((s) => s !== scope)));

  const create = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    try {
      const created = await apiKeyApi.create(workspace.id, { name: name.trim(), scopes });
      setRevealed(created);
      setName("");
      setScopes(["workflows:read"]);
      toast.success("API key created");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not create API key"));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: ApiKey) => {
    const ok = await confirm({
      title: `Revoke "${key.name}"?`,
      body: "Any integration using this key will immediately stop working. This can't be undone.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiKeyApi.revoke(workspace.id, key.id);
      toast.success("API key revoked");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not revoke key"));
    }
  };

  const copyKey = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn’t copy to clipboard");
    }
  };

  return (
    <Dialog open={open} onClose={close} size="lg">
      <DialogHeader title="API keys" description={`Programmatic access to ${workspace.name}`} icon={<KeyIcon />} />
      <DialogBody className="space-y-5">
        {!canManage ? (
          <p className="text-[12px] text-faint">
            API keys are managed by workspace admins and owners. Ask one to create a key for you.
          </p>
        ) : revealed ? (
          <RevealedKey created={revealed} copied={copied} onCopy={copyKey} onDone={() => setRevealed(null)} />
        ) : (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
            <Label>Create a key</Label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CI deploy bot"
                maxLength={80}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                className="flex-1"
              />
              <Button onClick={() => void create()} loading={creating} disabled={!name.trim() || scopes.length === 0}>
                <PlusIcon /> Create
              </Button>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-3">
              {ALL_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-[12.5px] text-muted">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) => toggleScope(scope, e.target.checked)}
                    className="size-3.5 accent-[var(--color-accent)]"
                  />
                  <span className="font-mono text-[11.5px] text-ink">{scope}</span>
                  <span className="text-faint">— {SCOPE_META[scope].blurb}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            Active keys {keys ? `· ${keys.length}` : ""}
          </h3>
          {keys && keys.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[12.5px] text-faint">
              No API keys yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {keys?.map((key) => (
                <li
                  key={key.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{key.name}</p>
                    <p className="flex items-center gap-2 truncate text-[11.5px] text-faint">
                      <code className="font-mono text-muted">{key.prefix}…</code>
                      <span>· used {timeAgo(key.lastUsedAt)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {key.scopes.map((s) => (
                      <Badge key={s} color={s === "workflows:run" ? "#5b8cff" : "#34d0a8"}>
                        {SCOPE_META[s]?.label ?? s}
                      </Badge>
                    ))}
                    {canManage ? (
                      <button
                        type="button"
                        aria-label={`Revoke ${key.name}`}
                        onClick={() => void revoke(key)}
                        className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-danger"
                      >
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ApiReference />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={close}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** The one-time reveal of a freshly-created key's plaintext, with copy. */
function RevealedKey({
  created,
  copied,
  onCopy,
  onDone,
}: {
  created: CreatedApiKey;
  copied: boolean;
  onCopy: () => void;
  onDone: () => void;
}) {
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-3">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-accent-bright">
        <CheckIcon className="text-[14px]" /> Key “{created.name}” created
      </div>
      <p className="mt-1 text-[11.5px] text-muted">
        Copy it now — for security, this is the only time the full key is shown.
      </p>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-void/60 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-spark/90">{created.key}</code>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy API key"
          className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
        >
          {copied ? <CheckIcon className="text-[14px] text-accent-bright" /> : <CopyIcon />}
        </button>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="mt-2 text-[12px] font-medium text-muted transition-colors hover:text-ink"
      >
        I’ve copied it — done
      </button>
    </div>
  );
}

/** Minimal, in-app API reference: auth header, endpoints, and a runnable curl. */
function ApiReference() {
  const [open, setOpen] = useState(false);
  const base = `${API_URL}/api/v1`;
  const curl = [
    `curl -X POST ${base}/workflows/WORKFLOW_ID/runs \\`,
    `  -H "X-API-Key: flux_your_key_here" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"payload": {"hello": "world"}}'`,
  ].join("\n");

  return (
    <section className="rounded-xl border border-white/8 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-[12.5px] font-semibold text-ink">API reference</span>
        <span className="text-[11px] text-faint">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-white/8 p-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Authentication</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Send your key in the <code className="font-mono text-ink">X-API-Key</code> header. The key is scoped to
              this workspace; reads need the <code className="font-mono text-ink">workflows:read</code> scope, triggering
              runs needs <code className="font-mono text-ink">workflows:run</code>.
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Endpoints</p>
            <ul className="mt-1 space-y-1 font-mono text-[11.5px] text-muted">
              <Endpoint method="GET" path="/api/v1/workflows" note="list workflows" />
              <Endpoint method="GET" path="/api/v1/workflows/:id" note="get a workflow" />
              <Endpoint method="POST" path="/api/v1/workflows/:id/runs" note="trigger a run" />
              <Endpoint method="GET" path="/api/v1/runs" note="list runs" />
              <Endpoint method="GET" path="/api/v1/runs/:id" note="run status + output" />
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Example</p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-white/8 bg-void/60 p-3 font-mono text-[11.5px] leading-relaxed text-spark/90">
              {curl}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Endpoint({ method, path, note }: { method: string; path: string; note: string }) {
  const color = method === "POST" ? "#5b8cff" : "#34d0a8";
  return (
    <li className="flex items-center gap-2">
      <span className="w-10 shrink-0 font-semibold" style={{ color }}>
        {method}
      </span>
      <span className="text-ink">{path}</span>
      <span className="text-faint">— {note}</span>
    </li>
  );
}
