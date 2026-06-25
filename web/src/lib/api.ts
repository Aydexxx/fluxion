import axios, { AxiosError } from "axios";
import type {
  AnalyticsResult,
  AuthResponse,
  Credential,
  CredentialTypeSpec,
  NodeTestResult,
  RunFilters,
  RunSummary,
  UpdateWorkflowResponse,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowSummary,
  WorkspaceRunSummary,
  Workspace,
} from "./types";

const TOKEN_KEY = "fluxion.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000",
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** A callback the auth store registers so a 401 anywhere forces a clean sign-out. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error.response?.status === 401 && getToken()) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** Pulls a human-readable message out of the backend's `{ error: { message } }` shape. */
export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? error.message ?? fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export const authApi = {
  async register(name: string, email: string, password: string): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>("/auth/register", { name, email, password });
    return data;
  },
  async login(email: string, password: string): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>("/auth/login", { email, password });
    return data;
  },
  async me(): Promise<AuthResponse["user"]> {
    const { data } = await api.get<AuthResponse["user"]>("/auth/me");
    return data;
  },
  async workspaces(): Promise<Workspace[]> {
    const { data } = await api.get<Workspace[]>("/workspaces");
    return data;
  },
};

export const workflowApi = {
  async list(workspaceId: string): Promise<WorkflowSummary[]> {
    const { data } = await api.get<WorkflowSummary[]>("/workflows", { params: { workspaceId } });
    return data;
  },
  async get(id: string): Promise<Workflow> {
    const { data } = await api.get<Workflow>(`/workflows/${id}`);
    return data;
  },
  async create(workspaceId: string, name: string, description?: string): Promise<Workflow> {
    const { data } = await api.post<Workflow>("/workflows", { workspaceId, name, description });
    return data;
  },
  async update(
    id: string,
    patch: { name?: string; description?: string | null; isActive?: boolean; definition?: WorkflowDefinition },
  ): Promise<UpdateWorkflowResponse> {
    const { data } = await api.put<UpdateWorkflowResponse>(`/workflows/${id}`, patch);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/workflows/${id}`);
  },
  /**
   * Execute a single node in isolation, feeding it sample upstream data. `config`
   * overrides the saved node config (so unsaved edits are testable); `trigger`
   * and `sources` supply `{{ trigger.* }}` / `{{ nodeId.* }}` context.
   */
  async testNode(
    workflowId: string,
    nodeId: string,
    body: { config?: Record<string, unknown>; trigger?: unknown; sources?: Record<string, unknown> },
  ): Promise<NodeTestResult> {
    const { data } = await api.post<NodeTestResult>(`/workflows/${workflowId}/nodes/${nodeId}/test`, body);
    return data;
  },
};

export const credentialApi = {
  /** The credential type catalog used to render the right fields per type. */
  async types(): Promise<CredentialTypeSpec[]> {
    const { data } = await api.get<CredentialTypeSpec[]>("/credentials/types");
    return data;
  },
  async list(workspaceId: string): Promise<Credential[]> {
    const { data } = await api.get<Credential[]>("/credentials", { params: { workspaceId } });
    return data;
  },
  async create(input: { workspaceId: string; name: string; type: string; data: Record<string, string> }): Promise<Credential> {
    const { data } = await api.post<Credential>("/credentials", input);
    return data;
  },
  async update(id: string, patch: { name?: string; data?: Record<string, string> }): Promise<Credential> {
    const { data } = await api.put<Credential>(`/credentials/${id}`, patch);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/credentials/${id}`);
  },
};

export const runApi = {
  /** Trigger a synchronous run; resolves with the finished run + node executions. */
  async start(workflowId: string, payload?: unknown): Promise<WorkflowRun> {
    const { data } = await api.post<WorkflowRun>(`/workflows/${workflowId}/run`, { payload });
    return data;
  },
  async history(workflowId: string): Promise<RunSummary[]> {
    const { data } = await api.get<RunSummary[]>(`/workflows/${workflowId}/runs`);
    return data;
  },
  async get(runId: string): Promise<WorkflowRun> {
    const { data } = await api.get<WorkflowRun>(`/runs/${runId}`);
    return data;
  },
  /** List runs across a whole workspace, with optional filters (runs dashboard). */
  async listWorkspace(workspaceId: string, filters: RunFilters & { limit?: number } = {}): Promise<WorkspaceRunSummary[]> {
    const { data } = await api.get<WorkspaceRunSummary[]>("/runs", { params: { workspaceId, ...filters } });
    return data;
  },
  /** Re-run a past run with the same trigger payload; returns the queued replay. */
  async replay(runId: string): Promise<WorkflowRun> {
    const { data } = await api.post<WorkflowRun>(`/runs/${runId}/replay`);
    return data;
  },
};

export const analyticsApi = {
  async get(workspaceId: string, range: { from?: string; to?: string } = {}): Promise<AnalyticsResult> {
    const { data } = await api.get<AnalyticsResult>("/analytics", { params: { workspaceId, ...range } });
    return data;
  },
};
