import type { ComponentType } from "react";
import { FieldShell, Select, TextArea, TextInput } from "../components/Field";
import { CopyIcon, PlusIcon, TrashIcon } from "../components/icons";
import { useEditor } from "./editorStore";
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

function HttpForm({ config, onChange }: ConfigFormProps) {
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
          <TextInput
            placeholder="https://api.example.com/v1/resource"
            value={str(config.url)}
            onChange={(e) => set({ url: e.target.value })}
          />
        </FieldShell>
      </div>
      <FieldShell label="Headers" hint="One per line, as Key: Value.">
        <TextArea
          rows={3}
          placeholder={"Authorization: Bearer …\nContent-Type: application/json"}
          value={str(config.headers)}
          onChange={(e) => set({ headers: e.target.value })}
        />
      </FieldShell>
      <FieldShell label="Body">
        <TextArea
          rows={4}
          placeholder={'{\n  "key": "value"\n}'}
          value={str(config.body)}
          onChange={(e) => set({ body: e.target.value })}
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

function TransformForm({ config, onChange }: ConfigFormProps) {
  const mappings = readMappings(config);
  const commit = (next: Mapping[]) => onChange({ ...config, mappings: next });

  return (
    <FieldShell label="Field mappings" hint="Map output keys to source expressions.">
      <div className="space-y-2">
        {mappings.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <TextInput
              placeholder="key"
              value={m.key}
              onChange={(e) => commit(mappings.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            />
            <span className="text-faint">→</span>
            <TextInput
              placeholder="source.value"
              value={m.value}
              onChange={(e) => commit(mappings.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <button
              type="button"
              aria-label="Remove mapping"
              onClick={() => commit(mappings.filter((_, j) => j !== i))}
              className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
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

function AiForm({ config, onChange }: ConfigFormProps) {
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
        <TextArea
          rows={6}
          placeholder={"Summarize the following in three bullets:\n\n{{ input.text }}"}
          value={str(config.prompt)}
          onChange={(e) => set({ prompt: e.target.value })}
        />
      </FieldShell>
    </div>
  );
}

/* ── logic.condition ────────────────────────────────────────────────────── */
function ConditionForm({ config, onChange }: ConfigFormProps) {
  return (
    <FieldShell label="Expression" hint="Compare with == != > < >= <=. True routes the true branch, false the false branch.">
      <TextArea
        rows={3}
        placeholder="{{ input.status }} == 200"
        value={str(config.expression)}
        onChange={(e) => onChange({ ...config, expression: e.target.value })}
      />
    </FieldShell>
  );
}

/* ── output.response ────────────────────────────────────────────────────── */
function ResponseForm({ config, onChange }: ConfigFormProps) {
  return (
    <FieldShell label="Response body" hint="What the workflow returns to its caller.">
      <TextArea
        rows={6}
        placeholder={'{\n  "ok": true,\n  "result": "{{ input }}"\n}'}
        value={str(config.body)}
        onChange={(e) => onChange({ ...config, body: e.target.value })}
      />
    </FieldShell>
  );
}

const FORMS: Record<string, ComponentType<ConfigFormProps>> = {
  "trigger.manual": ManualTriggerForm,
  "trigger.webhook": WebhookForm,
  "trigger.schedule": ScheduleForm,
  "action.http": HttpForm,
  "action.transform": TransformForm,
  "ai.llm": AiForm,
  "logic.condition": ConditionForm,
  "output.response": ResponseForm,
};

export function getConfigForm(type: string): ComponentType<ConfigFormProps> | null {
  return FORMS[type] ?? null;
}

/** Used by the config panel header to show "no settings" affordances tastefully. */
export function hasConfigForm(type: string): boolean {
  return type in FORMS && type !== "trigger.manual";
}
