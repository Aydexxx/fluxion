import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { motion } from "framer-motion";
import { useEditor } from "../editor/editorStore";
import { EditorTopBar } from "../editor/EditorTopBar";
import { NodePalette } from "../editor/NodePalette";
import { WorkflowCanvas } from "../editor/WorkflowCanvas";
import { ConfigPanel } from "../editor/ConfigPanel";
import { RunResultsBar } from "../editor/RunResultsBar";
import { RunHistoryDrawer } from "../editor/RunHistoryDrawer";
import { VersionHistoryDrawer } from "../editor/VersionHistoryDrawer";
import { CommandPalette } from "../editor/CommandPalette";
import { ShortcutsHelp } from "../editor/ShortcutsHelp";
import { FirstRunGuide } from "../editor/FirstRunGuide";
import { FailureAlertDialog } from "../editor/FailureAlertDialog";
import { useEditorShortcuts } from "../editor/useEditorShortcuts";
import { connectPresence, disconnectPresence, sendSelection } from "../editor/presence";
import { CredentialsManager } from "../components/CredentialsManager";
import { VariablesManager } from "../components/VariablesManager";
import { navigate } from "../lib/router";
import { Logo, SpinnerIcon } from "../components/icons";

export function EditorPage({ workflowId }: { workflowId: string }) {
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const load = useEditor((s) => s.load);
  const reset = useEditor((s) => s.reset);
  const workspaceId = useEditor((s) => s.workspaceId);
  const credentialsManagerOpen = useEditor((s) => s.credentialsManagerOpen);
  const setCredentialsManagerOpen = useEditor((s) => s.setCredentialsManagerOpen);
  const refreshCredentials = useEditor((s) => s.refreshCredentials);
  const variablesManagerOpen = useEditor((s) => s.variablesManagerOpen);
  const setVariablesManagerOpen = useEditor((s) => s.setVariablesManagerOpen);
  const refreshVariables = useEditor((s) => s.refreshVariables);
  // While previewing a past version the editor is read-only: no palette, no inspector.
  const previewing = useEditor((s) => s.previewVersion !== null);
  const applyRemoteGraphOps = useEditor((s) => s.applyRemoteGraphOps);

  useEffect(() => {
    void load(workflowId);
    return () => reset();
  }, [workflowId, load, reset]);

  // Real-time multi-user awareness: join the workflow's presence room, mirror
  // peers' graph edits into the store, and broadcast our own selection.
  useEffect(() => {
    connectPresence(workflowId, applyRemoteGraphOps);
    let prevKey = "";
    const unsubscribe = useEditor.subscribe((s) => {
      const ids = s.nodes.filter((n) => n.selected).map((n) => n.id);
      const key = ids.join("|");
      if (key !== prevKey) {
        prevKey = key;
        sendSelection(ids);
      }
    });
    return () => {
      unsubscribe();
      disconnectPresence();
    };
  }, [workflowId, applyRemoteGraphOps]);

  return (
    <ReactFlowProvider>
      <EditorKeyboardLayer />
      <div className="flex h-screen flex-col bg-base">
        <EditorTopBar />
        <div className="relative flex min-h-0 flex-1">
          {previewing ? null : <NodePalette />}
          <main className="relative min-w-0 flex-1">
            <WorkflowCanvas />
            {previewing ? null : <ConfigPanel />}
            <RunResultsBar />
            <RunHistoryDrawer />
            <VersionHistoryDrawer />
            {status === "loading" ? <LoadingVeil /> : null}
            {status === "error" ? <ErrorVeil message={error} /> : null}
            <FirstRunGuide />
          </main>
        </div>
      </div>
      <CommandPalette />
      <ShortcutsHelp />
      <FailureAlertDialog />
      <CredentialsManager
        open={credentialsManagerOpen}
        workspaceId={workspaceId}
        onClose={() => {
          setCredentialsManagerOpen(false);
          void refreshCredentials();
        }}
      />
      <VariablesManager
        open={variablesManagerOpen}
        workspaceId={workspaceId}
        onClose={() => {
          setVariablesManagerOpen(false);
          void refreshVariables();
        }}
      />
    </ReactFlowProvider>
  );
}

/** Registers the global editor keyboard layer; must live inside the ReactFlow provider. */
function EditorKeyboardLayer() {
  useEditorShortcuts();
  return null;
}

function LoadingVeil() {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-base/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center gap-3 text-muted"
      >
        <Logo className="text-[26px] text-accent" />
        <SpinnerIcon className="animate-spin text-[18px]" />
      </motion.div>
    </div>
  );
}

function ErrorVeil({ message }: { message: string | null }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-base/80 backdrop-blur-sm">
      <div className="max-w-sm text-center">
        <h2 className="font-display text-lg font-semibold text-ink">Couldn’t open this workflow</h2>
        <p className="mt-1.5 text-sm text-muted">{message ?? "It may have been deleted."}</p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-5 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-white/5"
        >
          Back to workflows
        </button>
      </div>
    </div>
  );
}
