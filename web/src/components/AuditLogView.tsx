import { useEffect, useState } from "react";
import { auditApi, errorMessage } from "../lib/api";
import type { AuditActor, AuditLogEntry, Workspace } from "../lib/types";
import { timeAgo } from "../lib/format";
import { useToast } from "./ui/toast";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Label, Select, TextInput } from "./Field";
import { HistoryIcon } from "./icons";

interface Props {
  open: boolean;
  workspace: Workspace;
  onClose: () => void;
}

/** Human label per audit action key (keep in sync with the server's AUDIT_ACTIONS). */
const ACTION_LABELS: Record<string, string> = {
  "member.invited": "invited",
  "member.added": "joined",
  "member.removed": "removed",
  "member.role_changed": "changed the role of",
  "workflow.created": "created workflow",
  "workflow.published": "published workflow",
  "workflow.deleted": "deleted workflow",
  "credential.created": "created credential",
  "credential.deleted": "deleted credential",
  "run.failed": "run failed for",
};

/** Options for the action filter, grouped logically. */
const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "member.invited", label: "Member invited" },
  { value: "member.added", label: "Member joined" },
  { value: "member.removed", label: "Member removed" },
  { value: "member.role_changed", label: "Role changed" },
  { value: "workflow.created", label: "Workflow created" },
  { value: "workflow.published", label: "Workflow published" },
  { value: "workflow.deleted", label: "Workflow deleted" },
  { value: "credential.created", label: "Credential created" },
  { value: "credential.deleted", label: "Credential deleted" },
  { value: "run.failed", label: "Run failed" },
];

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** A one-line, human rendering of an audit entry. */
function EntryLine({ entry }: { entry: AuditLogEntry }) {
  const actor = entry.actorName ?? "System";
  const meta = entry.metadata ?? {};
  const roleChange =
    entry.action === "member.role_changed" && meta.from && meta.to ? ` (${String(meta.from)} → ${String(meta.to)})` : "";
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
      <div className="min-w-0 text-[12.5px] leading-relaxed">
        <span className="font-medium text-ink">{actor}</span>{" "}
        <span className="text-muted">{actionLabel(entry.action)}</span>{" "}
        {entry.targetName ? <span className="text-ink">{entry.targetName}</span> : null}
        <span className="text-faint">{roleChange}</span>
      </div>
      <span className="shrink-0 text-[11px] text-faint" title={new Date(entry.createdAt).toLocaleString()}>
        {timeAgo(entry.createdAt)}
      </span>
    </li>
  );
}

/**
 * Read-only, admin/owner-only audit log for a workspace: a paginated, filterable
 * (actor / action / date) feed of who did what. The server re-enforces the
 * admin gate, so a non-admin simply sees an error here.
 */
export function AuditLogView({ open, workspace, onClose }: Props) {
  const toast = useToast();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters.
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters = {
    actorId: actorId || undefined,
    action: action || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await auditApi.list(workspace.id, { ...filters, cursor: nextCursor, limit: 30 });
      setEntries((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      toast.error(errorMessage(err, "Could not load more"));
    } finally {
      setLoadingMore(false);
    }
  };

  // (Re)load the first page whenever the dialog opens or a filter changes. The
  // fetch is inlined (no synchronous setState) and guarded so a stale response
  // from a superseded filter can't overwrite a newer one.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const page = await auditApi.list(workspace.id, { ...filters, limit: 30 });
        if (!alive) return;
        setEntries(page.entries);
        setActors(page.actors);
        setNextCursor(page.nextCursor);
        setLoaded(true);
      } catch (err) {
        if (alive) toast.error(errorMessage(err, "Could not load the audit log"));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspace.id, actorId, action, from, to]);

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogHeader title="Activity log" description={`Audit trail for ${workspace.name}`} icon={<HistoryIcon />} />
      <DialogBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <Label>Actor</Label>
            <Select value={actorId} onChange={(e) => setActorId(e.target.value)} className="mt-1">
              <option value="">Everyone</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Action</Label>
            <Select value={action} onChange={(e) => setAction(e.target.value)} className="mt-1">
              {ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>From</Label>
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>To</Label>
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
          </div>
        </div>

        <ul className="space-y-1.5">
          {loaded && entries.length === 0 ? (
            <li className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-[12px] text-faint">
              No activity matches these filters.
            </li>
          ) : (
            entries.map((entry) => <EntryLine key={entry.id} entry={entry} />)
          )}
        </ul>

        {nextCursor ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="w-full rounded-lg border border-white/8 py-2 text-[12px] text-muted transition-colors hover:border-white/14 hover:text-ink disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load older"}
          </button>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
