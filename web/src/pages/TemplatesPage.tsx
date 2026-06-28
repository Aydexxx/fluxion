import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../store/auth";
import { templateApi, errorMessage } from "../lib/api";
import type { TemplateSummary, UserTemplate } from "../lib/types";
import { navigate } from "../lib/router";
import { canEdit } from "../lib/permissions";
import { useToast } from "../components/ui/toast";
import { confirm } from "../components/ui/confirm";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../components/ui/Dialog";
import { Button } from "../components/ui/Button";
import { Label, TextArea, TextInput } from "../components/Field";
import { CardSkeletonGrid, EmptyState, ErrorState } from "../components/ui/states";
import { ChevronRightIcon, EditIcon, LayersIcon, SparkIcon, SpinnerIcon, TrashIcon } from "../components/icons";
import { CATEGORIES, getNodeSpec } from "../editor/nodeCatalog";
import { riseIn, stagger, still } from "../lib/motion";

type Tab = "builtin" | "custom";

export function TemplatesPage() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const workspace = useAuth((s) => s.workspace);
  const canManage = canEdit(workspace?.role);

  const [tab, setTab] = useState<Tab>("builtin");

  const [builtin, setBuiltin] = useState<TemplateSummary[] | null>(null);
  const [custom, setCustom] = useState<UserTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserTemplate | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [customReloadToken, setCustomReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setBuiltin(null);
      setError(null);
      try {
        const list = await templateApi.list();
        if (alive) setBuiltin(list);
      } catch (err) {
        if (alive) setError(errorMessage(err, "Could not load templates"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    void (async () => {
      setCustom(null);
      setCustomError(null);
      try {
        const list = await templateApi.listCustom(workspace.id);
        if (alive) setCustom(list);
      } catch (err) {
        if (alive) setCustomError(errorMessage(err, "Could not load your templates"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspace, customReloadToken]);

  const handleUseBuiltin = async (template: TemplateSummary) => {
    if (!workspace || usingId) return;
    setUsingId(template.id);
    try {
      const wf = await templateApi.instantiate(template.id, workspace.id);
      toast.success("Template added — opening editor");
      navigate(`/workflows/${wf.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not use this template"));
      setUsingId(null);
    }
  };

  const handleUseCustom = async (template: UserTemplate) => {
    if (usingId) return;
    setUsingId(template.id);
    try {
      const wf = await templateApi.instantiateCustom(template.id);
      toast.success("Template added — opening editor");
      navigate(`/workflows/${wf.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not use this template"));
      setUsingId(null);
    }
  };

  const handleDelete = async (template: UserTemplate) => {
    const ok = await confirm({
      title: "Delete template?",
      body: (
        <>
          <span className="text-ink">{template.name}</span> will be removed from My Templates. Workflows already created
          from it are unaffected.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await templateApi.removeCustom(template.id);
      setCustom((prev) => prev?.filter((t) => t.id !== template.id) ?? null);
      toast.success("Template deleted");
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete template"));
    }
  };

  return (
    <main className="relative mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="font-display text-[28px] font-semibold tracking-tight text-gradient">Templates</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">
          Start from a working example, or reuse one your team has saved — every template lands pre-wired and ready to
          run.
        </p>
      </motion.div>

      <div className="mt-6 flex items-center gap-1 border-b border-white/8">
        <TabButton active={tab === "builtin"} onClick={() => setTab("builtin")} label="Built-in" count={builtin?.length} />
        <TabButton
          active={tab === "custom"}
          onClick={() => setTab("custom")}
          label="My Templates"
          count={custom?.length}
        />
      </div>

      <div className="mt-6">
        {tab === "builtin" ? (
          error ? (
            <ErrorState title="Couldn’t load templates" message={error} onRetry={() => setReloadToken((t) => t + 1)} />
          ) : builtin === null ? (
            <CardSkeletonGrid count={4} className="grid grid-cols-1 gap-4 md:grid-cols-2" cardClassName="h-[220px]" />
          ) : builtin.length === 0 ? (
            <EmptyState icon={<SparkIcon />} title="No templates yet" description="Check back soon." />
          ) : (
            <Grid reduce={!!reduce}>
              {builtin.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  reduce={!!reduce}
                  busy={usingId === template.id}
                  disabled={!workspace || (usingId !== null && usingId !== template.id)}
                  onUse={() => handleUseBuiltin(template)}
                />
              ))}
            </Grid>
          )
        ) : customError ? (
          <ErrorState
            title="Couldn’t load your templates"
            message={customError}
            onRetry={() => setCustomReloadToken((t) => t + 1)}
          />
        ) : custom === null ? (
          <CardSkeletonGrid count={2} className="grid grid-cols-1 gap-4 md:grid-cols-2" cardClassName="h-[220px]" />
        ) : custom.length === 0 ? (
          <EmptyState
            icon={<LayersIcon />}
            title="No saved templates yet"
            description={
              canManage
                ? "Open a workflow and choose “Save as template” to reuse it across your workspace."
                : "Templates saved by editors in this workspace will appear here."
            }
            action={
              <button
                type="button"
                onClick={() => navigate("/")}
                className="rounded-xl border border-white/10 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/5"
              >
                Go to workflows
              </button>
            }
          />
        ) : (
          <Grid reduce={!!reduce}>
            {custom.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                reduce={!!reduce}
                busy={usingId === template.id}
                disabled={usingId !== null && usingId !== template.id}
                onUse={() => handleUseCustom(template)}
                manage={
                  canManage
                    ? { onEdit: () => setEditing(template), onDelete: () => void handleDelete(template) }
                    : undefined
                }
                footnote={template.createdByName ? `Saved by ${template.createdByName}` : "Saved template"}
              />
            ))}
          </Grid>
        )}
      </div>

      <EditTemplateDialog
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setCustom((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? null);
          setEditing(null);
        }}
      />
    </main>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors"
      style={{
        borderColor: active ? "var(--color-accent)" : "transparent",
        color: active ? "var(--color-ink)" : "var(--color-muted)",
      }}
    >
      {label}
      {typeof count === "number" ? (
        <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[10.5px] text-faint">{count}</span>
      ) : null}
    </button>
  );
}

function Grid({ children, reduce }: { children: React.ReactNode; reduce: boolean }) {
  return (
    <motion.div
      variants={reduce ? still : stagger(0.04, 0.06)}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      {children}
    </motion.div>
  );
}

function TemplateCard({
  template,
  reduce,
  busy,
  disabled,
  onUse,
  manage,
  footnote,
}: {
  template: TemplateSummary;
  reduce: boolean;
  busy: boolean;
  disabled: boolean;
  onUse: () => void;
  manage?: { onEdit: () => void; onDelete: () => void };
  footnote?: string;
}) {
  // The card accent follows the trigger node's category — a calm, type-true hue.
  const accent = CATEGORIES[getNodeSpec(template.nodeTypes[0] ?? "trigger.manual").category].accent;

  return (
    <motion.div
      variants={reduce ? still : riseIn}
      whileHover={reduce ? undefined : { y: -3 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-surface/60 p-5 transition-colors hover:border-white/14"
    >
      <div
        aria-hidden
        className="absolute -right-12 -top-12 size-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `color-mix(in oklab, ${accent} 26%, transparent)` }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <h3 className="text-[15.5px] font-semibold text-ink">{template.name}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {manage ? (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label={`Edit ${template.name}`}
                onClick={manage.onEdit}
                className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
              >
                <EditIcon className="text-[14px]" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${template.name}`}
                onClick={manage.onDelete}
                className="rounded-lg p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-300"
              >
                <TrashIcon className="text-[14px]" />
              </button>
            </div>
          ) : null}
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.12em]"
            style={{ color: accent, background: `color-mix(in oklab, ${accent} 14%, transparent)` }}
          >
            {template.category}
          </span>
        </div>
      </div>

      <p className="relative mt-1.5 text-[13px] leading-relaxed text-muted">
        {template.description || "No description yet."}
      </p>

      <FlowPreview nodeTypes={template.nodeTypes} />

      <div className="relative mt-5 flex items-center justify-between">
        <span className="text-[12px] text-faint">
          {footnote ??
            `${template.nodeTypes.length} node type${template.nodeTypes.length === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          onClick={onUse}
          disabled={disabled || busy}
          className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold text-white transition-all disabled:opacity-60"
          style={{
            background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
            boxShadow: "0 10px 28px -12px color-mix(in oklab, var(--color-accent) 75%, transparent)",
          }}
        >
          {busy ? <SpinnerIcon className="animate-spin text-[14px]" /> : null}
          {busy ? "Adding…" : "Use template"}
        </button>
      </div>
    </motion.div>
  );
}

/** A small left-to-right strip of the template's node icons — a glanceable flow shape. */
function FlowPreview({ nodeTypes }: { nodeTypes: string[] }) {
  return (
    <div className="relative mt-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-white/6 bg-void/40 px-3 py-3">
      {nodeTypes.map((type, i) => {
        const spec = getNodeSpec(type);
        const accent = CATEGORIES[spec.category].accent;
        const Icon = spec.icon;
        return (
          <div key={`${type}-${i}`} className="flex items-center gap-1.5">
            <span
              className="flex items-center gap-1.5 rounded-lg px-2 py-1"
              style={{
                color: accent,
                background: `color-mix(in oklab, ${accent} 12%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 24%, transparent)`,
              }}
              title={spec.label}
            >
              <Icon className="text-[14px]" />
              <span className="text-[11.5px] font-medium text-ink/90">{spec.label}</span>
            </span>
            {i < nodeTypes.length - 1 ? <ChevronRightIcon className="text-[12px] text-faint" /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Rename / edit-description dialog for a user template. */
function EditTemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: UserTemplate | null;
  onClose: () => void;
  onSaved: (updated: UserTemplate) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync the form to the template being edited, adjusting state during render
  // (keyed on identity) rather than in an effect.
  const [editingId, setEditingId] = useState<string | null>(null);
  const currentId = template?.id ?? null;
  if (currentId !== editingId) {
    setEditingId(currentId);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setSaving(false);
  }

  const submit = async () => {
    if (!template || !name.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await templateApi.updateCustom(template.id, {
        name: name.trim(),
        description: description.trim() || null,
      });
      toast.success("Template updated");
      onSaved(updated);
    } catch (err) {
      toast.error(errorMessage(err, "Could not update template"));
      setSaving(false);
    }
  };

  return (
    <Dialog open={template !== null} onClose={onClose} size="sm">
      <DialogHeader title="Edit template" icon={<EditIcon />} />
      <DialogBody>
        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-tpl-name">Name</Label>
            <TextInput
              id="edit-tpl-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>
          <div>
            <Label htmlFor="edit-tpl-desc">Description</Label>
            <TextArea
              id="edit-tpl-desc"
              value={description}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this template do? (optional)"
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} loading={saving} disabled={!name.trim()}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
