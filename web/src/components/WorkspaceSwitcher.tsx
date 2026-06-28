import { useEffect, useRef, useState } from "react";
import { errorMessage, workspaceApi } from "../lib/api";
import type { WorkspaceRole } from "../lib/types";
import { isOwner, roleLabel } from "../lib/permissions";
import { useAuth } from "../store/auth";
import { useToast } from "./ui/toast";
import { confirm } from "./ui/confirm";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Label, TextInput } from "./Field";
import { Badge } from "./ui/Badge";
import { CheckIcon, ChevronRightIcon, GridIcon, PlusIcon, TrashIcon } from "./icons";

const ROLE_COLOR: Record<WorkspaceRole, string> = {
  owner: "#e0a33e",
  admin: "#b98aff",
  editor: "#5b8cff",
  viewer: "#8d8d99",
};

/**
 * Top-bar workspace switcher. Lists every workspace the user belongs to (with
 * their role), persists the active one, and handles creating/deleting
 * workspaces. Member management lives in the side panel's Settings group and
 * personal invitations in the profile menu, keeping this menu focused.
 */
export function WorkspaceSwitcher() {
  const toast = useToast();
  const workspaces = useAuth((s) => s.workspaces);
  const workspace = useAuth((s) => s.workspace);
  const setActiveWorkspace = useAuth((s) => s.setActiveWorkspace);
  const refreshWorkspaces = useAuth((s) => s.refreshWorkspaces);

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!workspace) return null;

  const createWorkspace = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await workspaceApi.create(newName.trim());
      await refreshWorkspaces(created.id);
      setActiveWorkspace(created.id);
      setNewName("");
      setCreateOpen(false);
      toast.success(`Created ${created.name}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not create workspace"));
    } finally {
      setCreating(false);
    }
  };

  const deleteWorkspace = async () => {
    const ok = await confirm({
      title: `Delete ${workspace.name}?`,
      body: "This permanently deletes the workspace and all its workflows, runs, and credentials. This cannot be undone.",
      confirmLabel: "Delete workspace",
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.remove(workspace.id);
      toast.success(`Deleted ${workspace.name}`);
      await refreshWorkspaces();
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete workspace"));
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="max-w-[160px] truncate">{workspace.name}</span>
        <Badge color={ROLE_COLOR[workspace.role]} dot={false} className="hidden sm:inline-flex">
          {roleLabel(workspace.role)}
        </Badge>
        <ChevronRightIcon className={`text-[13px] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1.5 w-72 overflow-hidden rounded-xl border border-white/10 bg-base/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          <p className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Workspaces</p>
          <ul className="max-h-64 overflow-y-auto">
            {workspaces.map((ws) => {
              const active = ws.id === workspace.id;
              return (
                <li key={ws.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveWorkspace(ws.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                  >
                    <GridIcon className="shrink-0 text-[14px] text-faint" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{ws.name}</span>
                    <Badge color={ROLE_COLOR[ws.role]} dot={false}>
                      {roleLabel(ws.role)}
                    </Badge>
                    {active ? <CheckIcon className="shrink-0 text-[14px] text-accent" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-1.5 h-px bg-white/8" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted transition-colors hover:bg-white/5 hover:text-ink"
          >
            <PlusIcon className="text-[14px]" /> New workspace
          </button>

          {isOwner(workspace.role) ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void deleteWorkspace()}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-faint transition-colors hover:bg-white/5 hover:text-danger"
            >
              <TrashIcon className="text-[14px]" /> Delete workspace
            </button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} size="sm">
        <DialogHeader title="New workspace" icon={<PlusIcon />} />
        <DialogBody>
          <Label htmlFor="ws-name">Workspace name</Label>
          <TextInput
            id="ws-name"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Acme Inc."
            onKeyDown={(e) => {
              if (e.key === "Enter") void createWorkspace();
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void createWorkspace()} loading={creating} disabled={!newName.trim()}>
            Create
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
