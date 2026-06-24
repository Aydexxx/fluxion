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
