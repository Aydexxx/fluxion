import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../store/auth";
import { templateApi, errorMessage } from "../lib/api";
import type { TemplateSummary } from "../lib/types";
import { navigate } from "../lib/router";
import { useToast } from "../components/ui/toast";
import { CardSkeletonGrid, EmptyState, ErrorState } from "../components/ui/states";
import { TopNav } from "../components/TopNav";
import { ChevronRightIcon, SparkIcon, SpinnerIcon } from "../components/icons";
import { CATEGORIES, getNodeSpec } from "../editor/nodeCatalog";
import { riseIn, stagger, still } from "../lib/motion";

export function TemplatesPage() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const workspace = useAuth((s) => s.workspace);

  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  // Bumped to force a refetch (used by the error-state retry).
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setTemplates(null);
      setError(null);
      try {
        const list = await templateApi.list();
        if (alive) setTemplates(list);
      } catch (err) {
        if (alive) setError(errorMessage(err, "Could not load templates"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const handleUse = async (template: TemplateSummary) => {
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

  return (
    <div className="relative h-screen overflow-y-auto bg-base">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bloom opacity-80" />

      <TopNav active="templates" />

      <main className="relative mx-auto max-w-6xl px-6 pb-20 pt-10">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="font-display text-[28px] font-semibold tracking-tight text-gradient">Templates</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Start from a working example — every template lands pre-wired with sample data, so it runs the moment it opens.
          </p>
        </motion.div>

        <div className="mt-8">
          {error ? (
            <ErrorState title="Couldn’t load templates" message={error} onRetry={() => setReloadToken((t) => t + 1)} />
          ) : templates === null ? (
            <CardSkeletonGrid count={4} className="grid grid-cols-1 gap-4 md:grid-cols-2" cardClassName="h-[220px]" />
          ) : templates.length === 0 ? (
            <EmptyState
              icon={<SparkIcon />}
              title="No templates yet"
              description="Templates are curated starting points. Check back soon, or start from a blank canvas."
              action={
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/5"
                >
                  Back to workflows
                </button>
              }
            />
          ) : (
            <motion.div
              variants={reduce ? still : stagger(0.04, 0.06)}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  reduce={!!reduce}
                  busy={usingId === template.id}
                  disabled={!workspace || (usingId !== null && usingId !== template.id)}
                  onUse={() => handleUse(template)}
                />
              ))}
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}

function TemplateCard({
  template,
  reduce,
  busy,
  disabled,
  onUse,
}: {
  template: TemplateSummary;
  reduce: boolean;
  busy: boolean;
  disabled: boolean;
  onUse: () => void;
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
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.12em]"
          style={{ color: accent, background: `color-mix(in oklab, ${accent} 14%, transparent)` }}
        >
          {template.category}
        </span>
      </div>

      <p className="relative mt-1.5 text-[13px] leading-relaxed text-muted">{template.description}</p>

      <FlowPreview nodeTypes={template.nodeTypes} />

      <div className="relative mt-5 flex items-center justify-between">
        <span className="text-[12px] text-faint">
          {template.nodeTypes.length} node type{template.nodeTypes.length === 1 ? "" : "s"}
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

