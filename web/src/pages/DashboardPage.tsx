import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../store/auth";
import { workflowApi, errorMessage } from "../lib/api";
import type { WorkflowSummary } from "../lib/types";
import { navigate } from "../lib/router";
import { useToast } from "../components/ui/toast";
import { confirm } from "../components/ui/confirm";
import { CardSkeletonGrid, EmptyState as EmptyStateUI, ErrorState } from "../components/ui/states";
import { Badge } from "../components/ui/Badge";
import { timeAgo } from "../lib/format";
import { TopNav } from "../components/TopNav";
import { GridIcon, Logo, PlusIcon, SparkIcon, SpinnerIcon, TrashIcon } from "../components/icons";
import { categoryAccent } from "../editor/nodeCatalog";
import { riseIn, stagger, still } from "../lib/motion";

export function DashboardPage() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const workspace = useAuth((s) => s.workspace);

  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Bumped to force a refetch (used by the error-state retry).
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    void (async () => {
      setWorkflows(null);
      setError(null);
      try {
        const list = await workflowApi.list(workspace.id);
        if (alive) setWorkflows(list);
      } catch (err) {
        if (alive) setError(errorMessage(err, "Could not load workflows"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspace, reloadToken]);

  const createWorkflow = async () => {
    if (!workspace || creating) return;
    setCreating(true);
    try {
      const wf = await workflowApi.create(workspace.id, "Untitled workflow");
      navigate(`/workflows/${wf.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not create workflow"));
      setCreating(false);
    }
  };

  const requestDelete = async (wf: WorkflowSummary) => {
    const ok = await confirm({
      title: "Delete workflow?",
      body: (
        <>
          <span className="text-ink">{wf.name}</span> and its entire graph will be permanently removed. This can’t be
          undone.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await workflowApi.remove(wf.id);
      setWorkflows((prev) => prev?.filter((w) => w.id !== wf.id) ?? null);
      toast.success("Workflow deleted");
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete workflow"));
    }
  };

  return (
    <div className="relative h-screen overflow-y-auto bg-base">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bloom opacity-80" />

      <TopNav active="workflows" />

      <main className="relative mx-auto max-w-6xl px-6 pb-20 pt-10">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-end justify-between gap-4"
        >
          <div>
            <h1 className="font-display text-[28px] font-semibold tracking-tight text-gradient">Workflows</h1>
            <p className="mt-1 text-sm text-muted">Design, automate, and orchestrate your pipelines.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate("/templates")}
              className="flex items-center gap-2 rounded-xl border border-white/10 px-3.5 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/5"
            >
              <SparkIcon className="text-[16px] text-accent-bright" />
              Templates
            </button>
            <button
              type="button"
              onClick={createWorkflow}
              disabled={creating || !workspace}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-white transition-all disabled:opacity-70"
              style={{
                background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
                boxShadow: "0 12px 34px -12px color-mix(in oklab, var(--color-accent) 75%, transparent)",
              }}
            >
              {creating ? <SpinnerIcon className="animate-spin text-[16px]" /> : <PlusIcon className="text-[16px]" />}
              New workflow
            </button>
          </div>
        </motion.div>

        <div className="mt-8">
          {error ? (
            <ErrorState title="Couldn’t load workflows" message={error} onRetry={() => setReloadToken((t) => t + 1)} />
          ) : workflows === null ? (
            <CardSkeletonGrid count={6} />
          ) : workflows.length === 0 ? (
            <EmptyWorkflows onCreate={createWorkflow} creating={creating} />
          ) : (
            <motion.div
              variants={reduce ? still : stagger(0.04, 0.05)}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
            >
              {workflows.map((wf) => (
                <WorkflowCard
                  key={wf.id}
                  wf={wf}
                  reduce={!!reduce}
                  onOpen={() => navigate(`/workflows/${wf.id}`)}
                  onDelete={() => requestDelete(wf)}
                />
              ))}
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}

function WorkflowCard({
  wf,
  reduce,
  onOpen,
  onDelete,
}: {
  wf: WorkflowSummary;
  reduce: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  // A deterministic accent per card from its id keeps the grid colorful-but-restrained.
  const accents = ["#8b7bff", "#4c9bff", "#c26bff", "#34d0a8", "#e0a33e"];
  const accent = accents[hash(wf.id) % accents.length] ?? categoryAccent("action.http");

  return (
    <motion.div
      variants={reduce ? still : riseIn}
      whileHover={reduce ? undefined : { y: -3 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen() : null)}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/8 bg-surface/60 p-5 transition-colors hover:border-white/14"
    >
      <div
        aria-hidden
        className="absolute -right-10 -top-10 size-28 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `color-mix(in oklab, ${accent} 30%, transparent)` }}
      />
      <div className="relative flex items-start justify-between">
        <div
          className="flex size-10 items-center justify-center rounded-xl text-[18px]"
          style={{
            color: accent,
            background: `color-mix(in oklab, ${accent} 14%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 26%, transparent)`,
          }}
        >
          <GridIcon />
        </div>
        <button
          type="button"
          aria-label="Delete workflow"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded-lg p-1.5 text-faint opacity-0 transition-all hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
        >
          <TrashIcon className="text-[16px]" />
        </button>
      </div>

      <h3 className="relative mt-4 truncate text-[15px] font-semibold text-ink">{wf.name}</h3>
      {wf.description ? (
        <p className="relative mt-1 line-clamp-2 text-[13px] text-muted">{wf.description}</p>
      ) : (
        <p className="relative mt-1 text-[13px] text-faint">No description yet</p>
      )}

      <div className="relative mt-5 flex items-center justify-between">
        <StatusPill active={wf.isActive} />
        <span className="text-[12px] text-faint">Edited {timeAgo(wf.updatedAt)}</span>
      </div>
    </motion.div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <Badge color={active ? "#34d0a8" : "#6b6b78"} glow={active}>
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}

function EmptyWorkflows({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  return (
    <EmptyStateUI
      icon={<Logo />}
      title="Build your first workflow"
      description="Start from a working template with sample data baked in, or open a blank canvas and wire triggers, actions, and AI models into something that runs itself."
      action={
        <button
          type="button"
          onClick={() => navigate("/templates")}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-white transition-all"
          style={{
            background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
            boxShadow: "0 12px 34px -12px color-mix(in oklab, var(--color-accent) 75%, transparent)",
          }}
        >
          <SparkIcon className="text-[16px]" />
          Start from template
        </button>
      }
      secondaryAction={
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/5 disabled:opacity-70"
        >
          {creating ? <SpinnerIcon className="animate-spin text-[16px]" /> : <PlusIcon className="text-[16px]" />}
          Start blank
        </button>
      }
    />
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
