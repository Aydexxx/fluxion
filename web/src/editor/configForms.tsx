import { type ComponentType, useEffect, useState } from "react";
import { FieldShell, Select, TextArea, TextInput } from "../components/Field";
import { CopyIcon, PlusIcon, TrashIcon } from "../components/icons";
import { useEditor } from "./editorStore";
import { ExpressionInput } from "./ExpressionInput";
import { workflowApi, errorMessage } from "../lib/api";
import type { WorkflowSummary } from "../lib/types";
import { toast } from "../store/toasts";

export interface ConfigFormProps {
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/* ── trigger.manual — no configuration ──────────────────────────────────── */
function ManualTriggerForm() {
  return (
    <p className="text-sm leading-relaxed text-muted">
      A manual trigger has no settings. The workflow runs whenever you press{" "}
      <span className="text-ink">Run</span>.
    </p>
  );
}

/* ── trigger.webhook — live generated URL + copy ────────────────────────── */
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function WebhookForm() {
  const token = useEditor((s) => s.webhookToken);
  const url = token ? `${API_URL}/webhooks/${token}` : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Webhook URL copied");
    } catch {
      toast.error("Couldn’t copy to clipboard");
    }
  };

  return (
    <div className="space-y-3">
      <FieldShell
        label="Endpoint"
        hint="POST to this URL to trigger the workflow. The trigger node receives the request body, headers and query."
      >
        {url ? (
          <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-void/60 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-spark/90" title={url}>
              {url}
            </span>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy webhook URL"
              className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <CopyIcon />
            </button>
          </div>
        ) : (
          <p className="text-[13px] text-muted">Save the workflow to generate its webhook URL.</p>
        )}
      </FieldShell>
      <p className="text-[11.5px] leading-relaxed text-faint">
        Only fires while the workflow is <span className="text-muted">Active</span>. Keep this URL secret — anyone with it
        can trigger the workflow.
      </p>
    </div>
  );
}

/* ── trigger.schedule — cron expression ─────────────────────────────────── */
const CRON_PRESETS = [
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily 9am", cron: "0 9 * * *" },
  { label: "Every 5 min", cron: "*/5 * * * *" },
  { label: "Mondays", cron: "0 9 * * 1" },
];

function ScheduleForm({ config, onChange }: ConfigFormProps) {
  const cron = str(config.cron);
  return (
    <div className="space-y-3">
      <FieldShell label="Cron expression" hint="Standard 5-field cron: minute hour day month weekday.">
        <TextInput
          placeholder="0 * * * *"
          value={cron}
          spellCheck={false}
          onChange={(e) => onChange({ ...config, cron: e.target.value })}
        />
      </FieldShell>
      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map((p) => (
          <button
            key={p.cron}
            type="button"
            onClick={() => onChange({ ...config, cron: p.cron })}
            className="rounded-md border border-white/8 px-2 py-1 text-[11.5px] text-muted transition-colors hover:border-white/14 hover:text-ink"
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint">
        Runs automatically while the workflow is <span className="text-muted">Active</span>. Disabling it cancels the
        schedule.
      </p>
    </div>
  );
}

/* ── action.http ────────────────────────────────────────────────────────── */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function HttpForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <FieldShell label="Method">
          <Select value={str(config.method, "GET")} onChange={(e) => set({ method: e.target.value })}>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="URL">
          <ExpressionInput
            nodeId={nodeId}
            singleLine
            placeholder="https://api.example.com/v1/resource"
            value={str(config.url)}
            onChange={(url) => set({ url })}
          />
        </FieldShell>
      </div>
      <FieldShell label="Headers" hint="One per line, as Key: Value.">
        <ExpressionInput
          nodeId={nodeId}
          rows={3}
          placeholder={"Authorization: Bearer …\nContent-Type: application/json"}
          value={str(config.headers)}
          onChange={(headers) => set({ headers })}
        />
      </FieldShell>
      <FieldShell label="Body">
        <ExpressionInput
          nodeId={nodeId}
          rows={4}
          placeholder={'{\n  "key": "value"\n}'}
          value={str(config.body)}
          onChange={(body) => set({ body })}
        />
      </FieldShell>
    </div>
  );
}

/* ── action.transform — key/value mappings ──────────────────────────────── */
interface Mapping {
  key: string;
  value: string;
}

function readMappings(config: Record<string, unknown>): Mapping[] {
  const raw = config.mappings;
  if (!Array.isArray(raw)) return [{ key: "", value: "" }];
  return raw.map((m) => ({ key: str((m as Mapping)?.key), value: str((m as Mapping)?.value) }));
}

function TransformForm({ nodeId, config, onChange }: ConfigFormProps) {
  const mappings = readMappings(config);
  const commit = (next: Mapping[]) => onChange({ ...config, mappings: next });

  return (
    <FieldShell label="Field mappings" hint="Map output keys to source expressions. Use the ⚡ picker to insert references.">
      <div className="space-y-2">
        {mappings.map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-[34%] shrink-0 pt-1.5">
              <TextInput
                placeholder="key"
                value={m.key}
                onChange={(e) => commit(mappings.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              />
            </div>
            <span className="pt-3 text-faint">→</span>
            <div className="min-w-0 flex-1">
              <ExpressionInput
                nodeId={nodeId}
                singleLine
                placeholder="{{ input.value }}"
                value={m.value}
                onChange={(value) => commit(mappings.map((x, j) => (j === i ? { ...x, value } : x)))}
              />
            </div>
            <button
              type="button"
              aria-label="Remove mapping"
              onClick={() => commit(mappings.filter((_, j) => j !== i))}
              className="mt-1.5 shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => commit([...mappings, { key: "", value: "" }])}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-accent-bright transition-colors hover:bg-accent/10"
        >
          <PlusIcon className="text-[14px]" /> Add mapping
        </button>
      </div>
    </FieldShell>
  );
}

/* ── ai.llm ─────────────────────────────────────────────────────────────── */
// Matches the engine's provider-agnostic layer. "Local stub" is deterministic
// and offline — the default so a workflow runs without any AI service wired up.
const AI_PROVIDERS = [
  { value: "none", label: "Local stub" },
  { value: "ollama", label: "Ollama" },
  { value: "openai", label: "OpenAI" },
];

function AiForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <FieldShell label="Provider">
          <Select value={str(config.provider, "none")} onChange={(e) => set({ provider: e.target.value })}>
            {AI_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="Model">
          <TextInput
            placeholder="llama3"
            value={str(config.model)}
            onChange={(e) => set({ model: e.target.value })}
          />
        </FieldShell>
      </div>
      <FieldShell label="Prompt" hint="Reference upstream output with {{ }} placeholders, e.g. {{ input.text }}.">
        <ExpressionInput
          nodeId={nodeId}
          rows={6}
          placeholder={"Summarize the following in three bullets:\n\n{{ input.text }}"}
          value={str(config.prompt)}
          onChange={(prompt) => set({ prompt })}
        />
      </FieldShell>
    </div>
  );
}

/* ── ai.openai — direct OpenAI chat completion ──────────────────────────── */
function OpenAiForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  return (
    <div className="space-y-4">
      <CredentialPicker credType="openai" value={str(config.credentialId)} onChange={(id) => set({ credentialId: id })} />
      <p className="-mt-1 text-[11.5px] leading-relaxed text-faint">
        With no credential selected, this node returns a deterministic offline stub — handy for building and testing a
        flow before a real key exists.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <FieldShell label="Model">
          <TextInput placeholder="gpt-4o-mini" value={str(config.model, "gpt-4o-mini")} onChange={(e) => set({ model: e.target.value })} />
        </FieldShell>
        <FieldShell label="Temperature" hint="Optional, 0–2.">
          <TextInput
            type="number"
            min={0}
            max={2}
            step={0.1}
            placeholder="(default)"
            value={typeof config.temperature === "number" ? String(config.temperature) : ""}
            onChange={(e) => set({ temperature: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </FieldShell>
      </div>
      <FieldShell label="System message" hint="Optional. Sets the assistant's behavior ahead of the prompt.">
        <ExpressionInput nodeId={nodeId} rows={2} placeholder="You are a concise assistant." value={str(config.system)} onChange={(system) => set({ system })} />
      </FieldShell>
      <FieldShell label="Prompt" hint="Reference upstream output with {{ }} placeholders, e.g. {{ input.text }}.">
        <ExpressionInput
          nodeId={nodeId}
          rows={6}
          placeholder={"Summarize the following in three bullets:\n\n{{ input.text }}"}
          value={str(config.prompt)}
          onChange={(prompt) => set({ prompt })}
        />
      </FieldShell>
    </div>
  );
}

/* ── credential picker (shared by secret-using nodes) ───────────────────── */
function CredentialPicker({ credType, value, onChange }: { credType: string; value: string; onChange: (id: string) => void }) {
  const credentials = useEditor((s) => s.credentials);
  const openManager = useEditor((s) => s.setCredentialsManagerOpen);
  const options = credentials.filter((c) => c.type === credType);

  return (
    <FieldShell label="Credential" hint="Resolved and decrypted only at run time, on the worker.">
      <div className="flex items-center gap-2">
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select a credential…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.last4 ? ` ••••${c.last4}` : ""}
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => openManager(true)}
          className="shrink-0 rounded-lg border border-white/8 px-2.5 py-2 text-[12px] text-muted transition-colors hover:border-white/14 hover:text-ink"
        >
          Manage
        </button>
      </div>
      {options.length === 0 ? (
        <p className="mt-1.5 text-[11.5px] text-faint">No matching credentials yet — add one with “Manage”.</p>
      ) : null}
    </FieldShell>
  );
}

/* ── action.email ───────────────────────────────────────────────────────── */
function EmailForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  return (
    <div className="space-y-4">
      <CredentialPicker credType="smtp" value={str(config.credentialId)} onChange={(id) => set({ credentialId: id })} />
      <FieldShell label="To">
        <ExpressionInput nodeId={nodeId} singleLine placeholder="someone@example.com" value={str(config.to)} onChange={(to) => set({ to })} />
      </FieldShell>
      <FieldShell label="Subject">
        <ExpressionInput nodeId={nodeId} singleLine placeholder="Subject line" value={str(config.subject)} onChange={(subject) => set({ subject })} />
      </FieldShell>
      <FieldShell label="Body" hint="Plain text. Reference upstream output with {{ }} placeholders.">
        <ExpressionInput nodeId={nodeId} rows={5} placeholder={"Hello {{ input.name }},"} value={str(config.text)} onChange={(text) => set({ text })} />
      </FieldShell>
    </div>
  );
}

/* ── action.slack ───────────────────────────────────────────────────────── */
function SlackForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  return (
    <div className="space-y-4">
      <CredentialPicker credType="slack_webhook" value={str(config.credentialId)} onChange={(id) => set({ credentialId: id })} />
      <FieldShell label="Message" hint="Posted to the Slack/Discord incoming webhook.">
        <ExpressionInput nodeId={nodeId} rows={5} placeholder={"Deploy finished for {{ input.repo }} ✅"} value={str(config.text)} onChange={(text) => set({ text })} />
      </FieldShell>
    </div>
  );
}

/* ── action.database ────────────────────────────────────────────────────── */
function readLines(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join("\n") : str(value);
}

function DatabaseForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const readOnly = config.readOnly !== false;
  return (
    <div className="space-y-4">
      <CredentialPicker credType="database" value={str(config.credentialId)} onChange={(id) => set({ credentialId: id })} />
      <FieldShell label="Query" hint="Use $1, $2… placeholders; values are bound, never concatenated.">
        <ExpressionInput nodeId={nodeId} rows={4} placeholder={"SELECT * FROM users WHERE id = $1"} value={str(config.query)} onChange={(query) => set({ query })} />
      </FieldShell>
      <FieldShell label="Parameters" hint="One per line, in order ($1, $2…). Supports {{ }} placeholders.">
        <ExpressionInput
          nodeId={nodeId}
          rows={2}
          placeholder={"{{ input.userId }}"}
          value={readLines(config.params)}
          onChange={(v) => set({ params: v.split("\n").map((s) => s.trim()).filter((s) => s !== "") })}
        />
      </FieldShell>
      <FieldShell label="Access">
        <Select value={readOnly ? "read" : "write"} onChange={(e) => set({ readOnly: e.target.value === "read" })}>
          <option value="read">Read-only (SELECT / WITH)</option>
          <option value="write">Allow writes</option>
        </Select>
      </FieldShell>
    </div>
  );
}

/* ── action.github ───────────────────────────────────────────────────────── */
const GITHUB_ACTIONS = [
  { value: "create_issue", label: "Create issue" },
  { value: "add_comment", label: "Add comment" },
  { value: "dispatch_workflow", label: "Dispatch workflow" },
];

function GithubForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const action = str(config.action, "create_issue");
  const rawInputs = config.inputs;
  const inputs: Mapping[] = Array.isArray(rawInputs)
    ? rawInputs.map((m) => ({ key: str((m as Mapping)?.key), value: str((m as Mapping)?.value) }))
    : [{ key: "", value: "" }];
  const commitInputs = (next: Mapping[]) => set({ inputs: next });

  return (
    <div className="space-y-4">
      <CredentialPicker credType="github_token" value={str(config.credentialId)} onChange={(id) => set({ credentialId: id })} />
      <div className="grid grid-cols-[8.5rem_1fr] gap-2">
        <FieldShell label="Action">
          <Select value={action} onChange={(e) => set({ action: e.target.value })}>
            {GITHUB_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="Repository">
          <ExpressionInput nodeId={nodeId} singleLine placeholder="owner/repo" value={str(config.repo)} onChange={(repo) => set({ repo })} />
        </FieldShell>
      </div>

      {action === "create_issue" ? (
        <>
          <FieldShell label="Title">
            <ExpressionInput nodeId={nodeId} singleLine placeholder="{{ input.summary }}" value={str(config.title)} onChange={(title) => set({ title })} />
          </FieldShell>
          <FieldShell label="Body">
            <ExpressionInput nodeId={nodeId} rows={4} placeholder="Issue description…" value={str(config.body)} onChange={(body) => set({ body })} />
          </FieldShell>
          <FieldShell label="Labels" hint="Comma-separated.">
            <TextInput placeholder="bug, urgent" value={str(config.labels)} onChange={(e) => set({ labels: e.target.value })} />
          </FieldShell>
        </>
      ) : action === "add_comment" ? (
        <>
          <FieldShell label="Issue number">
            <ExpressionInput nodeId={nodeId} singleLine placeholder="{{ input.issueNumber }}" value={str(config.issueNumber)} onChange={(issueNumber) => set({ issueNumber })} />
          </FieldShell>
          <FieldShell label="Comment body">
            <ExpressionInput nodeId={nodeId} rows={4} placeholder="Comment text…" value={str(config.body)} onChange={(body) => set({ body })} />
          </FieldShell>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <FieldShell label="Workflow file" hint="e.g. deploy.yml">
              <TextInput placeholder="deploy.yml" value={str(config.workflowFile)} onChange={(e) => set({ workflowFile: e.target.value })} />
            </FieldShell>
            <FieldShell label="Ref" hint="Branch or tag">
              <TextInput placeholder="main" value={str(config.ref, "main")} onChange={(e) => set({ ref: e.target.value })} />
            </FieldShell>
          </div>
          <FieldShell label="Inputs" hint="Passed to the workflow_dispatch event.">
            <div className="space-y-2">
              {inputs.map((m, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-[34%] shrink-0 pt-1.5">
                    <TextInput placeholder="key" value={m.key} onChange={(e) => commitInputs(inputs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                  </div>
                  <span className="pt-3 text-faint">→</span>
                  <div className="min-w-0 flex-1">
                    <ExpressionInput
                      nodeId={nodeId}
                      singleLine
                      placeholder="{{ input.value }}"
                      value={m.value}
                      onChange={(value) => commitInputs(inputs.map((x, j) => (j === i ? { ...x, value } : x)))}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Remove input"
                    onClick={() => commitInputs(inputs.filter((_, j) => j !== i))}
                    className="mt-1.5 shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => commitInputs([...inputs, { key: "", value: "" }])}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-accent-bright transition-colors hover:bg-accent/10"
              >
                <PlusIcon className="text-[14px]" /> Add input
              </button>
            </div>
          </FieldShell>
        </>
      )}
    </div>
  );
}

/* ── action.notion ───────────────────────────────────────────────────────── */
const NOTION_ACTIONS = [
  { value: "create_page", label: "Create page" },
  { value: "append_text", label: "Append text" },
];

function NotionForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const action = str(config.action, "create_page");
  const parentType = str(config.parentType, "page");

  return (
    <div className="space-y-4">
      <CredentialPicker credType="notion_token" value={str(config.credentialId)} onChange={(id) => set({ credentialId: id })} />
      <FieldShell label="Action">
        <Select value={action} onChange={(e) => set({ action: e.target.value })}>
          {NOTION_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
      </FieldShell>

      {action === "create_page" ? (
        <>
          <div className="grid grid-cols-[8.5rem_1fr] gap-2">
            <FieldShell label="Parent">
              <Select value={parentType} onChange={(e) => set({ parentType: e.target.value })}>
                <option value="page">Page</option>
                <option value="database">Database</option>
              </Select>
            </FieldShell>
            <FieldShell label="Parent ID">
              <ExpressionInput nodeId={nodeId} singleLine placeholder="Notion page or database id" value={str(config.parentId)} onChange={(parentId) => set({ parentId })} />
            </FieldShell>
          </div>
          {parentType === "database" ? (
            <FieldShell label="Title property" hint="The database's title-type column name (default 'Name').">
              <TextInput placeholder="Name" value={str(config.titleProperty)} onChange={(e) => set({ titleProperty: e.target.value })} />
            </FieldShell>
          ) : null}
          <FieldShell label="Title">
            <ExpressionInput nodeId={nodeId} singleLine placeholder="{{ input.title }}" value={str(config.title)} onChange={(title) => set({ title })} />
          </FieldShell>
          <FieldShell label="Content" hint="Optional opening paragraph for the new page.">
            <ExpressionInput nodeId={nodeId} rows={3} placeholder="Page body…" value={str(config.content)} onChange={(content) => set({ content })} />
          </FieldShell>
        </>
      ) : (
        <>
          <FieldShell label="Page ID">
            <ExpressionInput nodeId={nodeId} singleLine placeholder="{{ input.pageId }}" value={str(config.pageId)} onChange={(pageId) => set({ pageId })} />
          </FieldShell>
          <FieldShell label="Text" hint="Appended as a new paragraph block.">
            <ExpressionInput nodeId={nodeId} rows={3} placeholder="{{ input.update }}" value={str(config.text)} onChange={(text) => set({ text })} />
          </FieldShell>
        </>
      )}
    </div>
  );
}

/* ── logic.loop / iterate ───────────────────────────────────────────────── */
interface FieldRow {
  as: string;
  path: string;
}

function readFieldRows(config: Record<string, unknown>): FieldRow[] {
  const raw = config.fields;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((f) => ({ as: str((f as FieldRow)?.as), path: str((f as FieldRow)?.path) }));
}

function LoopForm({ nodeId, config, onChange }: ConfigFormProps) {
  const rows = readFieldRows(config);
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const commit = (next: FieldRow[]) => set({ fields: next });

  return (
    <div className="space-y-4">
      <FieldShell label="Items" hint="An array to iterate, e.g. {{ input.users }}. Empty uses the single upstream array.">
        <ExpressionInput nodeId={nodeId} singleLine placeholder="{{ input.users }}" value={str(config.items)} onChange={(items) => set({ items })} />
      </FieldShell>
      <FieldShell label="Project each item" hint="Optional. Map output keys to dotted paths within each item. Leave empty to pass items through.">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <TextInput placeholder="key" value={r.as} onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, as: e.target.value } : x)))} />
              <span className="text-faint">←</span>
              <TextInput placeholder="user.email" value={r.path} onChange={(e) => commit(rows.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} />
              <button
                type="button"
                aria-label="Remove field"
                onClick={() => commit(rows.filter((_, j) => j !== i))}
                className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => commit([...rows, { as: "", path: "" }])}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-accent-bright transition-colors hover:bg-accent/10"
          >
            <PlusIcon className="text-[14px]" /> Add field
          </button>
        </div>
      </FieldShell>
    </div>
  );
}

/* ── logic.filter ───────────────────────────────────────────────────────── */
const FILTER_OPERATORS = [
  { value: "truthy", label: "is truthy" },
  { value: "falsy", label: "is falsy" },
  { value: "==", label: "equals (==)" },
  { value: "!=", label: "not equals (!=)" },
  { value: ">", label: "greater than (>)" },
  { value: "<", label: "less than (<)" },
  { value: ">=", label: "at least (>=)" },
  { value: "<=", label: "at most (<=)" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
];

const NO_VALUE_OPS = new Set(["truthy", "falsy"]);

function FilterForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const operator = str(config.operator, "truthy");
  return (
    <div className="space-y-4">
      <FieldShell label="Items" hint="The array to filter, e.g. {{ input.users }}. Empty uses the single upstream array.">
        <ExpressionInput nodeId={nodeId} singleLine placeholder="{{ input.users }}" value={str(config.items)} onChange={(items) => set({ items })} />
      </FieldShell>
      <FieldShell label="Field" hint="Dotted path read from each item. Leave empty to test the item itself.">
        <TextInput placeholder="status" value={str(config.field)} onChange={(e) => set({ field: e.target.value })} />
      </FieldShell>
      <div className="grid grid-cols-2 gap-2">
        <FieldShell label="Operator">
          <Select value={operator} onChange={(e) => set({ operator: e.target.value })}>
            {FILTER_OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="Value">
          <TextInput
            placeholder={NO_VALUE_OPS.has(operator) ? "—" : "active"}
            disabled={NO_VALUE_OPS.has(operator)}
            value={str(config.value)}
            onChange={(e) => set({ value: e.target.value })}
          />
        </FieldShell>
      </div>
    </div>
  );
}

/* ── ai.agent ───────────────────────────────────────────────────────────── */
const AGENT_TOOLS = [
  { value: "rag_search", label: "Knowledge search (RAG)" },
  { value: "http_get", label: "HTTP GET (read-only)" },
];

function AgentForm({ nodeId, config, onChange }: ConfigFormProps) {
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const tools = Array.isArray(config.tools) ? (config.tools as string[]) : ["rag_search"];
  const knowledge = Array.isArray(config.knowledge) ? (config.knowledge as unknown[]).map(String) : [];

  const toggleTool = (value: string, on: boolean) =>
    set({ tools: on ? [...new Set([...tools, value])] : tools.filter((t) => t !== value) });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <FieldShell label="Provider">
          <Select value={str(config.provider, "none")} onChange={(e) => set({ provider: e.target.value })}>
            {AI_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="Model">
          <TextInput placeholder="(provider default)" value={str(config.model)} onChange={(e) => set({ model: e.target.value })} />
        </FieldShell>
      </div>
      <FieldShell label="Goal" hint="What the agent should accomplish. Supports {{ }} placeholders.">
        <ExpressionInput nodeId={nodeId} rows={4} placeholder={"Answer the customer question: {{ input.question }}"} value={str(config.goal)} onChange={(goal) => set({ goal })} />
      </FieldShell>
      <FieldShell label="Tools">
        <div className="space-y-1.5">
          {AGENT_TOOLS.map((t) => (
            <label key={t.value} className="flex items-center gap-2 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={tools.includes(t.value)}
                onChange={(e) => toggleTool(t.value, e.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              {t.label}
            </label>
          ))}
        </div>
      </FieldShell>
      <FieldShell label="Knowledge" hint="One document per line. Searched by the rag_search tool.">
        <TextArea
          rows={4}
          placeholder={"Refunds are processed within 5 business days.\nStandard shipping takes 3 to 7 days."}
          value={knowledge.join("\n")}
          onChange={(e) => set({ knowledge: e.target.value.split("\n").map((s) => s.trim()).filter((s) => s !== "") })}
        />
      </FieldShell>
      <FieldShell label="Max steps" hint="Tool-use iterations before the agent must answer (1–8).">
        <TextInput
          type="number"
          min={1}
          max={8}
          value={typeof config.maxSteps === "number" ? String(config.maxSteps) : "4"}
          onChange={(e) => set({ maxSteps: Math.max(1, Math.min(8, Number(e.target.value) || 4)) })}
        />
      </FieldShell>
    </div>
  );
}

/* ── logic.condition ────────────────────────────────────────────────────── */
function ConditionForm({ nodeId, config, onChange }: ConfigFormProps) {
  return (
    <FieldShell label="Expression" hint="Compare with == != > < >= <=. True routes the true branch, false the false branch.">
      <ExpressionInput
        nodeId={nodeId}
        rows={3}
        placeholder="{{ input.status }} == 200"
        value={str(config.expression)}
        onChange={(expression) => onChange({ ...config, expression })}
      />
    </FieldShell>
  );
}

/* ── flow.subworkflow — call another workflow as a step ─────────────────── */
function SubworkflowForm({ nodeId, config, onChange }: ConfigFormProps) {
  const workspaceId = useEditor((s) => s.workspaceId);
  const currentWorkflowId = useEditor((s) => s.id);
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load the workspace's other workflows for the target picker. A workflow can't
  // pick itself (that's an immediate cycle); the engine guards deeper cycles too.
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    void (async () => {
      try {
        const list = await workflowApi.list(workspaceId);
        if (alive) setWorkflows(list.filter((w) => w.id !== currentWorkflowId));
      } catch (err) {
        if (alive) setLoadError(errorMessage(err, "Couldn’t load workflows"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspaceId, currentWorkflowId]);

  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const targetId = str(config.workflowId);
  const rawInput = config.input;
  const mappings: Mapping[] = Array.isArray(rawInput)
    ? rawInput.map((m) => ({ key: str((m as Mapping)?.key), value: str((m as Mapping)?.value) }))
    : [{ key: "", value: "" }];
  const commitInput = (next: Mapping[]) => set({ input: next });
  const selectedMissing = targetId !== "" && workflows !== null && !workflows.some((w) => w.id === targetId);

  return (
    <div className="space-y-4">
      <FieldShell label="Target workflow" hint="Calls this workflow’s published version as a nested run.">
        {loadError ? (
          <p className="text-[12px] text-red-300">{loadError}</p>
        ) : (
          <Select value={targetId} onChange={(e) => set({ workflowId: e.target.value })}>
            <option value="">{workflows === null ? "Loading…" : "Select a workflow…"}</option>
            {selectedMissing ? <option value={targetId}>{targetId} (unavailable)</option> : null}
            {(workflows ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        )}
        {workflows !== null && workflows.length === 0 ? (
          <p className="mt-1.5 text-[11.5px] text-faint">No other workflows in this workspace yet.</p>
        ) : null}
      </FieldShell>

      <FieldShell label="Input mapping" hint="Map keys to expressions; the sub-workflow receives them as its trigger payload.">
        <div className="space-y-2">
          {mappings.map((m, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="w-[34%] shrink-0 pt-1.5">
                <TextInput
                  placeholder="key"
                  value={m.key}
                  onChange={(e) => commitInput(mappings.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                />
              </div>
              <span className="pt-3 text-faint">←</span>
              <div className="min-w-0 flex-1">
                <ExpressionInput
                  nodeId={nodeId}
                  singleLine
                  placeholder="{{ input.value }}"
                  value={m.value}
                  onChange={(value) => commitInput(mappings.map((x, j) => (j === i ? { ...x, value } : x)))}
                />
              </div>
              <button
                type="button"
                aria-label="Remove mapping"
                onClick={() => commitInput(mappings.filter((_, j) => j !== i))}
                className="mt-1.5 shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => commitInput([...mappings, { key: "", value: "" }])}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-accent-bright transition-colors hover:bg-accent/10"
          >
            <PlusIcon className="text-[14px]" /> Add field
          </button>
        </div>
      </FieldShell>
      <p className="-mt-1 text-[11.5px] leading-relaxed text-faint">
        The node’s output is the sub-workflow’s result — read it via{" "}
        <span className="font-mono text-[11px]">{"{{ " + nodeId + ".output }}"}</span>.
      </p>
    </div>
  );
}

/* ── output.response ────────────────────────────────────────────────────── */
function ResponseForm({ nodeId, config, onChange }: ConfigFormProps) {
  return (
    <FieldShell label="Response body" hint="What the workflow returns to its caller.">
      <ExpressionInput
        nodeId={nodeId}
        rows={6}
        placeholder={'{\n  "ok": true,\n  "result": "{{ input }}"\n}'}
        value={str(config.body)}
        onChange={(body) => onChange({ ...config, body })}
      />
    </FieldShell>
  );
}

/* ── shared error handling (on-error policy + per-node retry) ────────────── */
interface RetryConfig {
  maxAttempts?: number;
  backoffMs?: number;
}

function readRetry(config: Record<string, unknown>): { maxAttempts: number; backoffMs: number } {
  const retry = (config.retry ?? {}) as RetryConfig;
  const maxAttempts = typeof retry.maxAttempts === "number" ? retry.maxAttempts : 1;
  const backoffMs = typeof retry.backoffMs === "number" ? retry.backoffMs : 0;
  return { maxAttempts: Math.max(1, Math.min(10, maxAttempts)), backoffMs: Math.max(0, backoffMs) };
}

/**
 * On-error policy + per-node retry, shared by every executable node. `canRoute`
 * is false for nodes with no output handle (e.g. Response), where "route to
 * error path" has nowhere to go.
 */
export function ErrorHandlingForm({
  config,
  onChange,
  canRoute,
}: {
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  canRoute: boolean;
}) {
  const onError = config.onError === "continue" || config.onError === "route" ? (config.onError as string) : "stop";
  const { maxAttempts, backoffMs } = readRetry(config);
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  const setRetry = (patch: Partial<{ maxAttempts: number; backoffMs: number }>) =>
    set({ retry: { maxAttempts, backoffMs, ...patch } });

  return (
    <div className="space-y-4">
      <FieldShell label="On error" hint="What happens if this node fails after its retries are used up.">
        <Select value={onError} onChange={(e) => set({ onError: e.target.value })}>
          <option value="stop">Stop the run (default)</option>
          <option value="continue">Continue — skip & proceed</option>
          {canRoute ? <option value="route">Route to error path</option> : null}
        </Select>
      </FieldShell>

      {onError === "route" && canRoute ? (
        <p className="-mt-1 text-[11.5px] leading-relaxed text-faint">
          On failure, only edges from this node’s <span className="text-cat-logic">error</span> handle run, carrying{" "}
          <span className="font-mono text-[11px]">{"{{ error }}"}</span> — a try/catch branch.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <FieldShell label="Retry attempts" hint="Total tries within one run (1 = no retry).">
          <TextInput
            type="number"
            min={1}
            max={10}
            value={String(maxAttempts)}
            onChange={(e) => setRetry({ maxAttempts: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
          />
        </FieldShell>
        <FieldShell label="Backoff (ms)" hint="Wait between attempts.">
          <TextInput
            type="number"
            min={0}
            step={250}
            disabled={maxAttempts <= 1}
            value={String(backoffMs)}
            onChange={(e) => setRetry({ backoffMs: Math.max(0, Number(e.target.value) || 0) })}
          />
        </FieldShell>
      </div>
      <p className="-mt-1 text-[11.5px] leading-relaxed text-faint">
        Overrides the global queue retry for this node — a transient failure retries here, in place.
      </p>
    </div>
  );
}

const FORMS: Record<string, ComponentType<ConfigFormProps>> = {
  "trigger.manual": ManualTriggerForm,
  "trigger.webhook": WebhookForm,
  "trigger.schedule": ScheduleForm,
  "action.http": HttpForm,
  "action.transform": TransformForm,
  "action.email": EmailForm,
  "action.slack": SlackForm,
  "action.database": DatabaseForm,
  "action.github": GithubForm,
  "action.notion": NotionForm,
  "ai.llm": AiForm,
  "ai.agent": AgentForm,
  "ai.openai": OpenAiForm,
  "logic.condition": ConditionForm,
  "logic.loop": LoopForm,
  "logic.filter": FilterForm,
  "flow.subworkflow": SubworkflowForm,
  "output.response": ResponseForm,
};

export function getConfigForm(type: string): ComponentType<ConfigFormProps> | null {
  return FORMS[type] ?? null;
}

/** Used by the config panel header to show "no settings" affordances tastefully. */
export function hasConfigForm(type: string): boolean {
  return type in FORMS && type !== "trigger.manual";
}
