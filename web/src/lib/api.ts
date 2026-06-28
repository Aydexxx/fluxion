import axios, { AxiosError } from "axios";
import type {
  AnalyticsResult,
  ApiKey,
  ApiScope,
  AppNotification,
  AuditLogFilters,
  AuditLogPage,
  AuthResponse,
  CreatedApiKey,
  Credential,
  NotificationsPage,
  CredentialTypeSpec,
  FailureNotifyConfig,
  Folder,
  ListWorkflowsParams,
  NodeTestResult,
  PublishResponse,
  RunFilters,
  RunLogEntry,
  RunSummary,
  Tag,
  TemplateSummary,
  User,
  UserPreferences,
  UserTemplate,
  UpdateWorkflowResponse,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowSummary,
  WorkflowVersionDetail,
  WorkflowVersionSummary,
  WorkspaceRunsPage,
  Workspace,
  WorkspaceRole,
  WorkspaceMember,
  WorkspaceMembers,
  WorkspaceVariable,
  WorkspaceSecret,
  PendingInvite,
  MyInvite,
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
  /** Update display name and/or preferences; returns the refreshed user. */
  async updateProfile(patch: { name?: string; preferences?: UserPreferences }): Promise<User> {
    const { data } = await api.patch<User>("/auth/profile", patch);
    return data;
  },
  /** Change password after verifying the current one. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post("/auth/password", { currentPassword, newPassword });
  },
  /** Store a cropped avatar (a base64 image data URL); returns the refreshed user. */
  async setAvatar(avatarUrl: string): Promise<User> {
    const { data } = await api.put<User>("/auth/avatar", { avatarUrl });
    return data;
  },
  /** Remove the avatar, reverting to initials. */
  async removeAvatar(): Promise<User> {
    const { data } = await api.delete<User>("/auth/avatar");
    return data;
  },
};

export const workspaceApi = {
  async create(name: string): Promise<Workspace> {
    const { data } = await api.post<Workspace>("/workspaces", { name });
    return data;
  },
  async remove(workspaceId: string): Promise<void> {
    await api.delete(`/workspaces/${workspaceId}`);
  },
  /** Members + pending invites for the management screen. */
  async members(workspaceId: string): Promise<WorkspaceMembers> {
    const { data } = await api.get<WorkspaceMembers>(`/workspaces/${workspaceId}/members`);
    return data;
  },
  async invite(workspaceId: string, email: string, role: WorkspaceRole): Promise<PendingInvite> {
    const { data } = await api.post<PendingInvite>(`/workspaces/${workspaceId}/invites`, { email, role });
    return data;
  },
  async resendInvite(workspaceId: string, inviteId: string): Promise<PendingInvite> {
    const { data } = await api.post<PendingInvite>(`/workspaces/${workspaceId}/invites/${inviteId}/resend`);
    return data;
  },
  async revokeInvite(workspaceId: string, inviteId: string): Promise<void> {
    await api.delete(`/workspaces/${workspaceId}/invites/${inviteId}`);
  },
  async setRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const { data } = await api.patch<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, { role });
    return data;
  },
  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await api.delete(`/workspaces/${workspaceId}/members/${userId}`);
  },
};

export const inviteApi = {
  /** The current user's pending invites. */
  async mine(): Promise<MyInvite[]> {
    const { data } = await api.get<MyInvite[]>("/invites");
    return data;
  },
  /** Accept an invite; resolves with the workspace the user just joined. */
  async accept(inviteId: string): Promise<Workspace> {
    const { data } = await api.post<Workspace>(`/invites/${inviteId}/accept`);
    return data;
  },
  async decline(inviteId: string): Promise<void> {
    await api.post(`/invites/${inviteId}/decline`);
  },
};

export const workflowApi = {
  /** Lists a workspace's workflows; the server does all search/filter/sort. */
  async list(workspaceId: string, params: ListWorkflowsParams = {}): Promise<WorkflowSummary[]> {
    const { data } = await api.get<WorkflowSummary[]>("/workflows", {
      params: { workspaceId, ...params, isActive: params.isActive === undefined ? undefined : String(params.isActive) },
    });
    return data;
  },
  async get(id: string): Promise<Workflow> {
    const { data } = await api.get<Workflow>(`/workflows/${id}`);
    return data;
  },
  async create(
    workspaceId: string,
    name: string,
    options: { description?: string; folderId?: string; tags?: string[] } = {},
  ): Promise<Workflow> {
    const { data } = await api.post<Workflow>("/workflows", { workspaceId, name, ...options });
    return data;
  },
  async update(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      isActive?: boolean;
      definition?: WorkflowDefinition;
      failureNotify?: FailureNotifyConfig | null;
      /** Move into a folder, or `null` to un-file it. */
      folderId?: string | null;
      /** Replaces the full tag set. */
      tags?: string[];
    },
  ): Promise<UpdateWorkflowResponse> {
    const { data } = await api.put<UpdateWorkflowResponse>(`/workflows/${id}`, patch);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/workflows/${id}`);
  },
  /** Promote the current draft to published, snapshotting a new version. */
  async publish(id: string, note?: string): Promise<PublishResponse> {
    const { data } = await api.post<PublishResponse>(`/workflows/${id}/publish`, note ? { note } : {});
    return data;
  },
  /** Roll back to a past version (re-publishes it as a new version). */
  async rollback(id: string, versionId: string): Promise<PublishResponse> {
    const { data } = await api.post<PublishResponse>(`/workflows/${id}/versions/${versionId}/rollback`);
    return data;
  },
  /** The published version history, newest first. */
  async versions(id: string): Promise<WorkflowVersionSummary[]> {
    const { data } = await api.get<WorkflowVersionSummary[]>(`/workflows/${id}/versions`);
    return data;
  },
  /** A single version with its full definition (for read-only viewing). */
  async version(id: string, versionId: string): Promise<WorkflowVersionDetail> {
    const { data } = await api.get<WorkflowVersionDetail>(`/workflows/${id}/versions/${versionId}`);
    return data;
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

export const folderApi = {
  async list(workspaceId: string): Promise<Folder[]> {
    const { data } = await api.get<Folder[]>(`/workspaces/${workspaceId}/folders`);
    return data;
  },
  async create(workspaceId: string, name: string): Promise<Folder> {
    const { data } = await api.post<Folder>(`/workspaces/${workspaceId}/folders`, { name });
    return data;
  },
  async rename(workspaceId: string, folderId: string, name: string): Promise<Folder> {
    const { data } = await api.patch<Folder>(`/workspaces/${workspaceId}/folders/${folderId}`, { name });
    return data;
  },
  async remove(workspaceId: string, folderId: string): Promise<void> {
    await api.delete(`/workspaces/${workspaceId}/folders/${folderId}`);
  },
};

export const tagApi = {
  /** Every tag in the workspace, for filter/autocomplete UI. */
  async list(workspaceId: string): Promise<Tag[]> {
    const { data } = await api.get<Tag[]>(`/workspaces/${workspaceId}/tags`);
    return data;
  },
};

export const templateApi = {
  /** The prebuilt template gallery (static, server-defined). */
  async list(): Promise<TemplateSummary[]> {
    const { data } = await api.get<TemplateSummary[]>("/templates");
    return data;
  },
  /** Create a new workflow pre-populated from a template; resolves with the new workflow. */
  async instantiate(templateId: string, workspaceId: string, name?: string): Promise<Workflow> {
    const { data } = await api.post<Workflow>(`/templates/${templateId}/instantiate`, { workspaceId, name });
    return data;
  },

  /** The workspace's user-created templates (the "My Templates" gallery). */
  async listCustom(workspaceId: string): Promise<UserTemplate[]> {
    const { data } = await api.get<UserTemplate[]>("/templates/custom", { params: { workspaceId } });
    return data;
  },
  /** Capture a workflow's current draft as a reusable workspace template. */
  async createCustom(input: { workflowId: string; name: string; description?: string }): Promise<UserTemplate> {
    const { data } = await api.post<UserTemplate>("/templates/custom", input);
    return data;
  },
  /** Rename / re-describe a user template. */
  async updateCustom(
    templateId: string,
    patch: { name?: string; description?: string | null },
  ): Promise<UserTemplate> {
    const { data } = await api.patch<UserTemplate>(`/templates/custom/${templateId}`, patch);
    return data;
  },
  async removeCustom(templateId: string): Promise<void> {
    await api.delete(`/templates/custom/${templateId}`);
  },
  /** Create a new workflow pre-populated from a user template. */
  async instantiateCustom(templateId: string, name?: string): Promise<Workflow> {
    const { data } = await api.post<Workflow>(`/templates/custom/${templateId}/instantiate`, { name });
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

export const variableApi = {
  async list(workspaceId: string): Promise<WorkspaceVariable[]> {
    const { data } = await api.get<WorkspaceVariable[]>("/variables", { params: { workspaceId } });
    return data;
  },
  async create(workspaceId: string, input: { key: string; value: string }): Promise<WorkspaceVariable> {
    const { data } = await api.post<WorkspaceVariable>("/variables", { workspaceId, ...input });
    return data;
  },
  async update(id: string, patch: { key?: string; value?: string }): Promise<WorkspaceVariable> {
    const { data } = await api.put<WorkspaceVariable>(`/variables/${id}`, patch);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/variables/${id}`);
  },
};

export const secretApi = {
  /** Secrets list by key only — their values never leave the server. */
  async list(workspaceId: string): Promise<WorkspaceSecret[]> {
    const { data } = await api.get<WorkspaceSecret[]>("/secrets", { params: { workspaceId } });
    return data;
  },
  async create(workspaceId: string, input: { key: string; value: string }): Promise<WorkspaceSecret> {
    const { data } = await api.post<WorkspaceSecret>("/secrets", { workspaceId, ...input });
    return data;
  },
  /** Omit `value` to rename only; supply it to rotate the secret. */
  async update(id: string, patch: { key?: string; value?: string }): Promise<WorkspaceSecret> {
    const { data } = await api.put<WorkspaceSecret>(`/secrets/${id}`, patch);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/secrets/${id}`);
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
  /** A run's structured logs; pass `after` (a seq) to fetch only newer lines. */
  async logs(runId: string, after?: number): Promise<RunLogEntry[]> {
    const { data } = await api.get<RunLogEntry[]>(`/runs/${runId}/logs`, { params: after ? { after } : undefined });
    return data;
  },
  /** A page of runs across a whole workspace, with optional filters + keyset cursor (runs dashboard). */
  async listWorkspace(
    workspaceId: string,
    filters: RunFilters & { cursor?: string; limit?: number } = {},
  ): Promise<WorkspaceRunsPage> {
    const { data } = await api.get<WorkspaceRunsPage>("/runs", { params: { workspaceId, ...filters } });
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

export const notificationApi = {
  /** A page of the current user's notifications (newest first). */
  async list(params: { unread?: boolean; cursor?: string; limit?: number } = {}): Promise<NotificationsPage> {
    const { data } = await api.get<NotificationsPage>("/notifications", {
      params: { unread: params.unread ? "true" : undefined, cursor: params.cursor, limit: params.limit },
    });
    return data;
  },
  async unreadCount(): Promise<number> {
    const { data } = await api.get<{ count: number }>("/notifications/unread-count");
    return data.count;
  },
  async markRead(id: string): Promise<AppNotification> {
    const { data } = await api.post<AppNotification>(`/notifications/${id}/read`);
    return data;
  },
  async markAllRead(): Promise<number> {
    const { data } = await api.post<{ count: number }>("/notifications/read-all");
    return data.count;
  },
};

export const apiKeyApi = {
  /** Active API keys for a workspace (admin-only). */
  async list(workspaceId: string): Promise<ApiKey[]> {
    const { data } = await api.get<ApiKey[]>(`/workspaces/${workspaceId}/api-keys`);
    return data;
  },
  /** Create a key; the response's `key` is the plaintext, shown only this once. */
  async create(workspaceId: string, input: { name: string; scopes: ApiScope[] }): Promise<CreatedApiKey> {
    const { data } = await api.post<CreatedApiKey>(`/workspaces/${workspaceId}/api-keys`, input);
    return data;
  },
  async revoke(workspaceId: string, keyId: string): Promise<void> {
    await api.delete(`/workspaces/${workspaceId}/api-keys/${keyId}`);
  },
};

export const auditApi = {
  /** A page of a workspace's audit log (admin/owner only). */
  async list(
    workspaceId: string,
    filters: AuditLogFilters & { cursor?: string; limit?: number } = {},
  ): Promise<AuditLogPage> {
    const { data } = await api.get<AuditLogPage>(`/workspaces/${workspaceId}/audit-log`, { params: filters });
    return data;
  },
};
