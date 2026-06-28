import type { WorkspaceRole } from "./types";

/**
 * Client-side RBAC mirror of the server's role ranks. The server is always the
 * source of truth (every route re-checks); these helpers only decide what to
 * hide or disable so the UI never offers an action that would 403.
 */
const RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export function roleAtLeast(role: WorkspaceRole | undefined, min: WorkspaceRole): boolean {
  return role != null && RANK[role] >= RANK[min];
}

/** Can create/edit/run/publish workflows and manage credentials. */
export function canEdit(role: WorkspaceRole | undefined): boolean {
  return roleAtLeast(role, "editor");
}

/** Can manage members, invites, and delete workflows/credentials. */
export function canManageMembers(role: WorkspaceRole | undefined): boolean {
  return roleAtLeast(role, "admin");
}

/** Admin-tier destructive actions (delete workflow/credential). */
export function canDeleteResources(role: WorkspaceRole | undefined): boolean {
  return roleAtLeast(role, "admin");
}

/** Can delete the whole workspace and manage owners. */
export function isOwner(role: WorkspaceRole | undefined): boolean {
  return role === "owner";
}

export function isViewer(role: WorkspaceRole | undefined): boolean {
  return role === "viewer";
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export function roleLabel(role: WorkspaceRole): string {
  return ROLE_LABELS[role];
}

/** Short human description of what each role can do (for the members screen). */
export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Full control, including deleting the workspace and managing roles.",
  admin: "Manage members and all workflows & credentials.",
  editor: "Create, edit, run, and publish workflows; manage credentials.",
  viewer: "Read-only access to workflows, runs, and analytics.",
};
