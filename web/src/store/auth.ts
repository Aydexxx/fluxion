import { create } from "zustand";
import { authApi, setToken, setUnauthorizedHandler } from "../lib/api";
import type { User, Workspace } from "../lib/types";

type AuthStatus = "loading" | "authed" | "anon";

const ACTIVE_WORKSPACE_KEY = "fluxion.activeWorkspace";

function readActiveId(): string | null {
  return localStorage.getItem(ACTIVE_WORKSPACE_KEY);
}

function writeActiveId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  else localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
}

/** Pick the active workspace from a list: the persisted one if still present, else the first. */
function pickActive(workspaces: Workspace[]): Workspace | null {
  const savedId = readActiveId();
  return workspaces.find((w) => w.id === savedId) ?? workspaces[0] ?? null;
}

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Every workspace the user belongs to (powers the switcher). */
  workspaces: Workspace[];
  /** The active workspace; all workspace-scoped pages read from this. */
  workspace: Workspace | null;
  /** Rehydrate the session from a stored token on app start. */
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Replace the current user (after a profile/avatar/preferences update). */
  setUser: (user: User) => void;
  /** Switch the active workspace (persisted across reloads). */
  setActiveWorkspace: (workspaceId: string) => void;
  /** Re-fetch memberships (after accepting an invite, creating/deleting a workspace, role change). */
  refreshWorkspaces: (preferId?: string) => Promise<Workspace[]>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  workspaces: [],
  workspace: null,

  bootstrap: async () => {
    try {
      const [user, workspaces] = await Promise.all([authApi.me(), authApi.workspaces()]);
      const active = pickActive(workspaces);
      writeActiveId(active?.id ?? null);
      set({ status: "authed", user, workspaces, workspace: active });
    } catch {
      setToken(null);
      set({ status: "anon", user: null, workspaces: [], workspace: null });
    }
  },

  login: async (email, password) => {
    const { token, user } = await authApi.login(email, password);
    setToken(token);
    const workspaces = await authApi.workspaces();
    const active = pickActive(workspaces);
    writeActiveId(active?.id ?? null);
    set({ status: "authed", user, workspaces, workspace: active });
  },

  register: async (name, email, password) => {
    const { token, user } = await authApi.register(name, email, password);
    setToken(token);
    const workspaces = await authApi.workspaces();
    const active = pickActive(workspaces);
    writeActiveId(active?.id ?? null);
    set({ status: "authed", user, workspaces, workspace: active });
  },

  logout: () => {
    setToken(null);
    writeActiveId(null);
    set({ status: "anon", user: null, workspaces: [], workspace: null });
  },

  setUser: (user) => set({ user }),

  setActiveWorkspace: (workspaceId) => {
    const target = get().workspaces.find((w) => w.id === workspaceId);
    if (!target) return;
    writeActiveId(target.id);
    set({ workspace: target });
  },

  refreshWorkspaces: async (preferId) => {
    const workspaces = await authApi.workspaces();
    const current = get().workspace?.id;
    const desiredId = preferId ?? current;
    const active = workspaces.find((w) => w.id === desiredId) ?? pickActive(workspaces);
    writeActiveId(active?.id ?? null);
    set({ workspaces, workspace: active });
    return workspaces;
  },
}));

// A 401 from any request means the token is dead — drop the session.
setUnauthorizedHandler(() => useAuth.getState().logout());
