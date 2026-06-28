import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../store/auth";
import { workflowApi, folderApi, tagApi, errorMessage } from "../lib/api";
import type { Folder, Tag, WorkflowSummary } from "../lib/types";
import { navigate } from "../lib/router";
import { canDeleteResources, canEdit } from "../lib/permissions";
import { useToast } from "../components/ui/toast";
import { confirm } from "../components/ui/confirm";
import { CardSkeletonGrid, EmptyState as EmptyStateUI, ErrorState } from "../components/ui/states";
import { Badge } from "../components/ui/Badge";
import { timeAgo } from "../lib/format";
import { FolderRail, UNFILED } from "../components/FolderRail";
import { WorkflowFilterBar } from "../components/WorkflowFilterBar";
import { SORT_OPTIONS, DEFAULT_SORT, type SortOption, type StatusFilter } from "../lib/workflowFilters";
import { WorkflowOrganizer } from "../components/WorkflowOrganizer";
import { SaveAsTemplateDialog } from "../components/SaveAsTemplateDialog";
import { DashboardTour } from "../components/tour/DashboardTour";
import {
  FolderIcon,
  GridIcon,
  LayersIcon,
  Logo,
  PlusIcon,
  SearchIcon,
  SparkIcon,
  SpinnerIcon,
  TrashIcon,
} from "../components/icons";
import { categoryAccent } from "../editor/nodeCatalog";
import { riseIn, stagger, still } from "../lib/motion";

export function DashboardPage() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const workspace = useAuth((s) => s.workspace);
  const mayEdit = canEdit(workspace?.role);
  const mayDelete = canDeleteResources(workspace?.role);

  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Bumped to force a refetch (used by the error-state retry and after mutations).
  const [reloadToken, setReloadToken] = useState(0);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>(DEFAULT_SORT);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagId, setTagId] = useState<string | null>(null);
  // null = "All", UNFILED ("none") = "Unfiled", else a folder id.
  const [folderId, setFolderId] = useState<string | null>(null);

  const [organizing, setOrganizing] = useState<WorkflowSummary | null>(null);
  const [savingTemplate, setSavingTemplate] = useState<WorkflowSummary | null>(null);

  // Switching workspaces invalidates every filter — they reference that workspace's
  // data. Reset during render (React's documented pattern for "adjust state when a
  // prop/id changes") rather than an effect, so there's no extra render with stale filters.
  const [filtersForWorkspace, setFiltersForWorkspace] = useState(workspace?.id);
  if (workspace?.id !== filtersForWorkspace) {
    setFiltersForWorkspace(workspace?.id);
    setSearch("");
    setDebouncedSearch("");
    setSortOption(DEFAULT_SORT);
    setStatusFilter("all");
    setTagId(null);
    setFolderId(null);
  }

  // Debounce search so it doesn't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Folders + tags power the rail and filter dropdown; reload after any mutation.
  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    void (async () => {
      try {
        const [f, t] = await Promise.all([folderApi.list(workspace.id), tagApi.list(workspace.id)]);
        if (alive) {
          setFolders(f);
          setTags(t);
        }
      } catch {
        /* the workflow list's own error state covers the page; this is secondary chrome */
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspace, reloadToken]);

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    void (async () => {
      setWorkflows(null);
      setError(null);
      const sort = SORT_OPTIONS.find((o) => o.value === sortOption) ?? SORT_OPTIONS[0];
      try {
        const list = await workflowApi.list(workspace.id, {
          search: debouncedSearch || undefined,
          folderId: folderId ?? undefined,
          tagId: tagId ?? undefined,
          isActive: statusFilter === "all" ? undefined : statusFilter === "active",
          sortBy: sort.sortBy,
          sortDir: sort.sortDir,
        });
        if (alive) setWorkflows(list);
      } catch (err) {
        if (alive) setError(errorMessage(err, "Could not load workflows"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [workspace, reloadToken, debouncedSearch, sortOption, statusFilter, tagId, folderId]);

  const reload = () => setReloadToken((t) => t + 1);

  const createWorkflow = async () => {
    if (!workspace || creating) return;
    setCreating(true);
    try {
      // When viewing a real folder, create the workflow inside it. "All" (null)
      // and "Unfiled" (UNFILED) both mean "no folder", so we pass nothing.
      const inFolder = folderId !== null && folderId !== UNFILED ? folderId : undefined;
      const wf = await workflowApi.create(workspace.id, "Untitled workflow", { folderId: inFolder });
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
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete workflow"));
    }
  };

  const createFolder = async (name: string) => {
    if (!workspace) return;
    try {
      await folderApi.create(workspace.id, name);
      toast.success(`Created "${name}"`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Could not create folder"));
    }
  };

  const renameFolder = async (folder: Folder, name: string) => {
    if (!workspace) return;
    try {
      await folderApi.rename(workspace.id, folder.id, name);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Could not rename folder"));
    }
  };

  const deleteFolder = async (folder: Folder) => {
    if (!workspace) return;
    try {
      await folderApi.remove(workspace.id, folder.id);
      toast.success(`Deleted "${folder.name}"`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete folder"));
    }
  };

  const filtersActive = debouncedSearch !== "" || statusFilter !== "all" || tagId !== null || folderId !== null;

  // The breadcrumb's trailing crumb: the folder name, "Unfiled", or nothing at "All".
  const activeFolder = folderId && folderId !== UNFILED ? folders.find((f) => f.id === folderId) ?? null : null;
  const folderCrumb = folderId === UNFILED ? "Unfiled" : activeFolder?.name ?? null;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTagId(null);
    setSortOption(DEFAULT_SORT);
  };

  return (
    <>
      <main className="relative mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-10">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap items-end justify-between gap-4"
        >
          <div className="min-w-0">
            <nav aria-label="Breadcrumb">
              <h1 className="flex items-center gap-2 font-display text-[28px] font-semibold tracking-tight">
                <button
                  type="button"
                  onClick={() => setFolderId(null)}
                  aria-current={folderCrumb ? undefined : "page"}
                  className={folderCrumb ? "text-muted transition-colors hover:text-ink" : "text-gradient"}
                >
                  Workflows
                </button>
                {folderCrumb ? (
                  <>
                    <span className="text-faint">/</span>
                    <span className="truncate text-gradient" aria-current="page">
                      {folderCrumb}
                    </span>
                  </>
                ) : null}
              </h1>
            </nav>
            <p className="mt-1 text-sm text-muted">Design, automate, and orchestrate your pipelines.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <WorkflowFilterBar
              search={search}
              onSearchChange={setSearch}
              sortOption={sortOption}
              onSortChange={setSortOption}
              statusFilter={statusFilter}
              onStatusChange={setStatusFilter}
              tagId={tagId}
              onTagChange={setTagId}
              tags={tags}
              onClear={clearFilters}
            />
            <button
              type="button"
              data-tour="templates"
              onClick={() => navigate("/templates")}
              className="flex items-center gap-2 rounded-xl border border-white/10 px-3.5 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/5"
            >
              <SparkIcon className="text-[16px] text-accent-bright" />
              Templates
            </button>
            {mayEdit ? (
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
            ) : null}
          </div>
        </motion.div>

        <div className="mt-6">
          <FolderRail
            folders={folders}
            activeFolderId={folderId}
            onSelect={setFolderId}
            canEdit={mayEdit}
            onCreate={createFolder}
            onRename={renameFolder}
            onDelete={deleteFolder}
          />
        </div>

        <div className="mt-6">
          {error ? (
            <ErrorState title="Couldn’t load workflows" message={error} onRetry={reload} />
          ) : workflows === null ? (
            <CardSkeletonGrid count={6} />
          ) : workflows.length === 0 ? (
            filtersActive ? (
              <NoMatches
                onClear={() => {
                  clearFilters();
                  setFolderId(null);
                }}
              />
            ) : (
              <EmptyWorkflows onCreate={createWorkflow} creating={creating} />
            )
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
                  canDelete={mayDelete}
                  canOrganize={mayEdit}
                  canSaveTemplate={mayEdit}
                  onOpen={() => navigate(`/workflows/${wf.id}`)}
                  onDelete={() => requestDelete(wf)}
                  onOrganize={() => setOrganizing(wf)}
                  onSaveTemplate={() => setSavingTemplate(wf)}
                />
              ))}
            </motion.div>
          )}
        </div>
      </main>

      <WorkflowOrganizer
        workflow={organizing}
        folders={folders}
        knownTags={tags}
        onClose={() => setOrganizing(null)}
        onSaved={() => reload()}
      />

      <SaveAsTemplateDialog
        open={savingTemplate !== null}
        workflowId={savingTemplate?.id ?? null}
        defaultName={savingTemplate?.name ?? ""}
        onClose={() => setSavingTemplate(null)}
      />

      <DashboardTour enabled={workflows !== null} />
    </>
  );
}

function WorkflowCard({
  wf,
  reduce,
  canDelete,
  canOrganize,
  canSaveTemplate,
  onOpen,
  onDelete,
  onOrganize,
  onSaveTemplate,
}: {
  wf: WorkflowSummary;
  reduce: boolean;
  canDelete: boolean;
  canOrganize: boolean;
  canSaveTemplate: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onOrganize: () => void;
  onSaveTemplate: () => void;
}) {
  // A deterministic accent per card from its id keeps the grid colorful-but-restrained.
  const accents = ["#8b7bff", "#4c9bff", "#c26bff", "#34d0a8", "#e0a33e"];
  const accent = accents[hash(wf.id) % accents.length] ?? categoryAccent("action.http");
  const visibleTags = wf.tags.slice(0, 3);
  const extraTags = wf.tags.length - visibleTags.length;

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
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {canSaveTemplate ? (
            <button
              type="button"
              aria-label="Save as template"
              title="Save as template"
              onClick={(e) => {
                e.stopPropagation();
                onSaveTemplate();
              }}
              className="rounded-lg p-1.5 text-faint transition-all hover:bg-white/5 hover:text-ink"
            >
              <LayersIcon className="text-[16px]" />
            </button>
          ) : null}
          {canOrganize ? (
            <button
              type="button"
              aria-label="Organize workflow"
              onClick={(e) => {
                e.stopPropagation();
                onOrganize();
              }}
              className="rounded-lg p-1.5 text-faint transition-all hover:bg-white/5 hover:text-ink"
            >
              <FolderIcon className="text-[16px]" />
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              aria-label="Delete workflow"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded-lg p-1.5 text-faint transition-all hover:bg-red-500/10 hover:text-red-300"
            >
              <TrashIcon className="text-[16px]" />
            </button>
          ) : null}
        </div>
      </div>

      <h3 className="relative mt-4 truncate text-[15px] font-semibold text-ink">{wf.name}</h3>
      {wf.description ? (
        <p className="relative mt-1 line-clamp-2 text-[13px] text-muted">{wf.description}</p>
      ) : (
        <p className="relative mt-1 text-[13px] text-faint">No description yet</p>
      )}

      {wf.folder || wf.tags.length > 0 ? (
        <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
          {wf.folder ? (
            <span className="flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10.5px] text-faint">
              <FolderIcon className="text-[10px]" />
              {wf.folder.name}
            </span>
          ) : null}
          {visibleTags.map((t) => (
            <span key={t.id} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10.5px] capitalize text-faint">
              {t.name}
            </span>
          ))}
          {extraTags > 0 ? <span className="text-[10.5px] text-faint">+{extraTags}</span> : null}
        </div>
      ) : null}

      <div className="relative mt-4 flex items-center justify-between">
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

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyStateUI
      icon={<SearchIcon />}
      title="No workflows match"
      description="Try a different search, or clear the active filters."
      action={
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/5"
        >
          Clear filters
        </button>
      }
    />
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
