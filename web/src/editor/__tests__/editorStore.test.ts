import { beforeEach, describe, expect, it } from "vitest";
import type { NodeChange } from "@xyflow/react";
import { useEditor } from "../editorStore";
import type { FluxNode } from "../graph";

beforeEach(() => {
  useEditor.getState().reset();
});

function addNode(type = "trigger.manual"): FluxNode {
  useEditor.getState().addNodeAt(type, { x: 0, y: 0 });
  const { nodes } = useEditor.getState();
  return nodes[nodes.length - 1];
}

describe("addNodeAt / selectNode", () => {
  it("appends a node, selects it, and marks the graph dirty", () => {
    const node = addNode();
    const state = useEditor.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.selectedNodeId).toBe(node.id);
    expect(state.dirty).toBe(true);
  });
});

describe("onConnect", () => {
  it("ignores a self-loop connection", () => {
    const node = addNode();
    useEditor.setState({ dirty: false });
    useEditor.getState().onConnect({ source: node.id, target: node.id, sourceHandle: null, targetHandle: null });
    expect(useEditor.getState().edges).toHaveLength(0);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it("adds an edge between two distinct nodes and marks dirty", () => {
    const a = addNode();
    const b = addNode("output.response");
    useEditor.setState({ dirty: false });
    useEditor.getState().onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });

    const { edges, dirty } = useEditor.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: a.id, target: b.id });
    expect(dirty).toBe(true);
  });
});

describe("onNodesChange", () => {
  it("does not mark the graph dirty for selection-only changes", () => {
    const node = addNode();
    useEditor.setState({ dirty: false });
    const changes: NodeChange<FluxNode>[] = [{ id: node.id, type: "select", selected: true }];
    useEditor.getState().onNodesChange(changes);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it("marks the graph dirty for a position change", () => {
    const node = addNode();
    useEditor.setState({ dirty: false });
    const changes: NodeChange<FluxNode>[] = [{ id: node.id, type: "position", position: { x: 5, y: 5 } }];
    useEditor.getState().onNodesChange(changes);
    expect(useEditor.getState().dirty).toBe(true);
  });

  it("clears the selection when the selected node is removed", () => {
    const node = addNode();
    const changes: NodeChange<FluxNode>[] = [{ id: node.id, type: "remove" }];
    useEditor.getState().onNodesChange(changes);
    expect(useEditor.getState().selectedNodeId).toBeNull();
    expect(useEditor.getState().nodes).toHaveLength(0);
  });
});

describe("deleteNode", () => {
  it("removes the node and any edges touching it, and clears its selection", () => {
    const a = addNode();
    const b = addNode("output.response");
    useEditor.getState().onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });
    useEditor.getState().selectNode(a.id);

    useEditor.getState().deleteNode(a.id);

    const state = useEditor.getState();
    expect(state.nodes.map((n) => n.id)).toEqual([b.id]);
    expect(state.edges).toHaveLength(0);
    expect(state.selectedNodeId).toBeNull();
  });
});

describe("updateNodeConfig / updateNodeTitle", () => {
  it("updates only the targeted node's data and marks dirty", () => {
    const a = addNode();
    const b = addNode("output.response");
    useEditor.setState({ dirty: false });

    useEditor.getState().updateNodeConfig(a.id, { foo: "bar" });
    useEditor.getState().updateNodeTitle(b.id, "Renamed");

    const [nodeA, nodeB] = useEditor.getState().nodes;
    expect(nodeA.data.config).toEqual({ foo: "bar" });
    expect(nodeB.data.title).toBe("Renamed");
    expect(nodeB.data.config).not.toHaveProperty("foo");
    expect(useEditor.getState().dirty).toBe(true);
  });
});

describe("setName / setActive", () => {
  it("update their field and mark the graph dirty", () => {
    useEditor.getState().setName("New name");
    expect(useEditor.getState().name).toBe("New name");
    expect(useEditor.getState().dirty).toBe(true);

    useEditor.setState({ dirty: false });
    useEditor.getState().setActive(false);
    expect(useEditor.getState().isActive).toBe(false);
    expect(useEditor.getState().dirty).toBe(true);
  });
});

describe("undo / redo", () => {
  it("undoes and redoes adding a node", () => {
    const node = addNode();
    expect(useEditor.getState().nodes).toHaveLength(1);

    useEditor.getState().undo();
    expect(useEditor.getState().nodes).toHaveLength(0);

    useEditor.getState().redo();
    expect(useEditor.getState().nodes).toHaveLength(1);
    expect(useEditor.getState().nodes[0].id).toBe(node.id);
  });

  it("walks back through a multi-step edit sequence", () => {
    const a = addNode();
    const b = addNode("output.response");
    useEditor.getState().onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });
    expect(useEditor.getState().edges).toHaveLength(1);

    useEditor.getState().undo(); // undo connect
    expect(useEditor.getState().edges).toHaveLength(0);
    expect(useEditor.getState().nodes).toHaveLength(2);

    useEditor.getState().undo(); // undo add b
    expect(useEditor.getState().nodes).toHaveLength(1);

    useEditor.getState().undo(); // undo add a
    expect(useEditor.getState().nodes).toHaveLength(0);
  });

  it("is a no-op when there is nothing to undo or redo", () => {
    expect(() => useEditor.getState().undo()).not.toThrow();
    expect(() => useEditor.getState().redo()).not.toThrow();
    expect(useEditor.getState().nodes).toHaveLength(0);
  });

  it("clears the redo stack once a new edit is made", () => {
    addNode();
    useEditor.getState().undo();
    expect(useEditor.getState().future).toHaveLength(1);

    addNode("output.response");
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it("coalesces rapid config edits to the same node into one undo step", () => {
    const node = addNode("trigger.manual"); // default config is empty
    const before = useEditor.getState().past.length;

    useEditor.getState().updateNodeConfig(node.id, { note: "a" });
    useEditor.getState().updateNodeConfig(node.id, { note: "ab" });
    useEditor.getState().updateNodeConfig(node.id, { note: "abc" });

    // Only the first edit of the burst pushed a history entry.
    expect(useEditor.getState().past.length).toBe(before + 1);

    useEditor.getState().undo();
    // A single undo reverts the whole burst back to the node's default config.
    expect(useEditor.getState().nodes[0].data.config).toEqual({});
  });

  it("bounds the history stack", () => {
    for (let i = 0; i < 130; i++) addNode();
    expect(useEditor.getState().past.length).toBeLessThanOrEqual(100);
  });
});

describe("selection / clipboard", () => {
  it("selectAll selects every node", () => {
    addNode();
    addNode("output.response");
    useEditor.getState().selectAll();
    expect(useEditor.getState().nodes.every((n) => n.selected)).toBe(true);
  });

  it("deleteSelection removes the selected nodes and their edges as a group", () => {
    const a = addNode();
    const b = addNode("output.response");
    useEditor.getState().onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });
    useEditor.getState().selectAll();

    useEditor.getState().deleteSelection();

    expect(useEditor.getState().nodes).toHaveLength(0);
    expect(useEditor.getState().edges).toHaveLength(0);
  });

  it("copy + paste clones the selection with new ids and a position offset", () => {
    const node = addNode("action.http");
    useEditor.getState().updateNodeConfig(node.id, { url: "https://api.dev" });
    useEditor.getState().selectAll();

    useEditor.getState().copySelection();
    useEditor.getState().pasteClipboard();

    const { nodes } = useEditor.getState();
    expect(nodes).toHaveLength(2);
    const [original, pasted] = nodes;
    expect(pasted.id).not.toBe(original.id);
    expect(pasted.data.config).toEqual({ url: "https://api.dev" });
    expect(pasted.position.x).toBe(original.position.x + 24);
    expect(pasted.selected).toBe(true);
    expect(original.selected).toBe(false);
  });

  it("pasted config is independent of the original", () => {
    const node = addNode("action.http");
    useEditor.getState().updateNodeConfig(node.id, { url: "https://api.dev" });
    useEditor.getState().selectAll();
    useEditor.getState().copySelection();
    useEditor.getState().pasteClipboard();

    const [original, pasted] = useEditor.getState().nodes;
    (pasted.data.config as Record<string, unknown>).url = "https://changed";
    expect((original.data.config as Record<string, unknown>).url).toBe("https://api.dev");
  });

  it("remaps internal edges when pasting a connected selection", () => {
    const a = addNode();
    const b = addNode("output.response");
    useEditor.getState().onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });
    useEditor.getState().selectAll();

    useEditor.getState().copySelection();
    useEditor.getState().pasteClipboard();

    const { nodes, edges } = useEditor.getState();
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(2);
    const pastedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    const pastedEdge = edges.find((e) => pastedNodeIds.has(e.source) && pastedNodeIds.has(e.target));
    expect(pastedEdge).toBeDefined();
  });

  it("offsets each successive paste further so copies don't stack", () => {
    const node = addNode();
    useEditor.getState().selectAll();
    useEditor.getState().copySelection();

    useEditor.getState().pasteClipboard();
    useEditor.getState().pasteClipboard();

    const xs = useEditor.getState().nodes.map((n) => n.position.x);
    // original at 0, first paste +24, second paste +48
    expect(xs).toEqual([node.position.x, node.position.x + 24, node.position.x + 48]);
  });

  it("duplicateSelection clones in place with an offset", () => {
    addNode();
    useEditor.getState().selectAll();
    useEditor.getState().duplicateSelection();

    const { nodes } = useEditor.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes[1].selected).toBe(true);
    expect(nodes[1].position).toEqual({ x: 24, y: 24 });
  });

  it("copySelection does nothing when no node is selected", () => {
    addNode();
    useEditor.getState().selectNode(null);
    useEditor.getState().copySelection();
    expect(useEditor.getState().clipboard).toBeNull();
  });

  it("paste and duplicate are undoable", () => {
    addNode();
    useEditor.getState().selectAll();
    useEditor.getState().duplicateSelection();
    expect(useEditor.getState().nodes).toHaveLength(2);

    useEditor.getState().undo();
    expect(useEditor.getState().nodes).toHaveLength(1);
  });
});

describe("applyLiveEvent", () => {
  function withActiveRun(runId: string) {
    useEditor.setState({
      activeRun: {
        id: runId,
        workflowId: "wf",
        status: "running",
        trigger: "manual",
        payload: null,
        error: null,
        createdAt: null,
        startedAt: null,
        finishedAt: null,
        replayOfId: null,
        nodeExecutions: [],
      },
    });
  }

  it("ignores events for a run that isn't the active one", () => {
    withActiveRun("run-1");
    useEditor.getState().applyLiveEvent({ type: "node:started", runId: "run-other", nodeId: "n1" });
    expect(useEditor.getState().nodeRunStatus).toEqual({});
  });

  it("marks a node running on node:started", () => {
    withActiveRun("run-1");
    useEditor.getState().applyLiveEvent({ type: "node:started", runId: "run-1", nodeId: "n1" });
    expect(useEditor.getState().nodeRunStatus).toEqual({ n1: "running" });
  });

  it("marks a node success/failed on node:finished, leaving other nodes alone", () => {
    withActiveRun("run-1");
    useEditor.getState().applyLiveEvent({ type: "node:started", runId: "run-1", nodeId: "n1" });
    useEditor.getState().applyLiveEvent({ type: "node:started", runId: "run-1", nodeId: "n2" });
    useEditor.getState().applyLiveEvent({ type: "node:finished", runId: "run-1", nodeId: "n1", status: "success" });
    useEditor.getState().applyLiveEvent({ type: "node:finished", runId: "run-1", nodeId: "n2", status: "failed" });

    expect(useEditor.getState().nodeRunStatus).toEqual({ n1: "success", n2: "failed" });
  });

  it("resets per-node status on run:started", () => {
    withActiveRun("run-1");
    useEditor.setState({ nodeRunStatus: { stale: "success" } as never });
    useEditor.getState().applyLiveEvent({ type: "run:started", runId: "run-1", workflowId: "wf" });
    expect(useEditor.getState().nodeRunStatus).toEqual({});
    expect(useEditor.getState().running).toBe(true);
  });
});
