import { create } from "zustand";
import { authApi, setToken, setUnauthorizedHandler } from "../lib/api";
import type { User, Workspace } from "../lib/types";

type AuthStatus = "loading" | "authed" | "anon";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  workspace: Workspace | null;
  /** Rehydrate the session from a stored token on app start. */
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  workspace: null,

  bootstrap: async () => {
    try {
      const [user, workspaces] = await Promise.all([authApi.me(), authApi.workspaces()]);
      set({ status: "authed", user, workspace: workspaces[0] ?? null });
    } catch {
      setToken(null);
      set({ status: "anon", user: null, workspace: null });
    }
  },

  login: async (email, password) => {
    const { token, user } = await authApi.login(email, password);
    setToken(token);
    const workspaces = await authApi.workspaces();
    set({ status: "authed", user, workspace: workspaces[0] ?? null });
  },

  register: async (name, email, password) => {
    const { token, user, workspace } = await authApi.register(name, email, password);
    setToken(token);
    // Register returns the freshly-created default workspace directly.
    const active = workspace ?? (await authApi.workspaces())[0] ?? null;
    set({ status: "authed", user, workspace: active });
  },

  logout: () => {
    setToken(null);
    set({ status: "anon", user: null, workspace: null });
  },
}));

// A 401 from any request means the token is dead — drop the session.
setUnauthorizedHandler(() => useAuth.getState().logout());
