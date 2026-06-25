import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "../editorStore";
import type { FluxNode } from "../graph";
import type { GraphOp } from "../../lib/presenceEvents";

/**
 * Exercises the last-write-wins merge of graph edits received from a peer
 * (editorStore.applyRemoteGraphOps) — the client half of near-real-time
 * co-editing. The presence socket is never opened here (it's lazy), so these run
 * fully offline.
 */

beforeEach(() => {
  useEditor.getState().reset();
});

function addNode(type = "trigger.manual"): FluxNode {
  useEditor.getState().addNodeAt(type, { x: 0, y: 0 });
  const { nodes } = useEditor.getState();
  return nodes[nodes.length - 1];
}

const apply = (ops: GraphOp[]) => useEditor.getState().applyRemoteGraphOps(ops);

describe("applyRemoteGraphOps", () => {
  it("moves a node last-write-wins by overwriting its position", () => {
    const node = addNode();
    apply([{ t: "move", positions: [{ id: node.id, x: 120, y: 80 }] }]);
    const moved = useEditor.getState().nodes.find((n) => n.id === node.id);
    expect(moved?.position).toEqual({ x: 120, y: 80 });
  });

  it("upserts a brand-new node from a peer", () => {
    apply([
      {
        t: "upsert",
        nodes: [{ id: "peer_node", position: { x: 10, y: 10 }, data: { nodeType: "action.http", title: "From Bob", config: {} } }],
      },
    ]);
    const node = useEditor.getState().nodes.find((n) => n.id === "peer_node");
    expect(node).toBeDefined();
    expect(node?.data.title).toBe("From Bob");
  });

  it("upsert preserves the local user's selection flag on an existing node", () => {
    const node = addNode();
    useEditor.getState().selectNode(node.id);
    apply([{ t: "upsert", nodes: [{ id: node.id, position: { x: 0, y: 0 }, data: { ...node.data, title: "Renamed" } }] }]);
    const updated = useEditor.getState().nodes.find((n) => n.id === node.id);
    expect(updated?.data.title).toBe("Renamed");
    expect(updated?.selected).toBe(true); // selection not clobbered by the remote edit
  });

  it("removes a node and its incident edges", () => {
    const a = addNode();
    const b = addNode("output.response");
    useEditor.getState().onConnect({ source: a.id, target: b.id, sourceHandle: null, targetHandle: null });
    expect(useEditor.getState().edges).toHaveLength(1);

    apply([{ t: "remove", nodeIds: [a.id] }]);
    const state = useEditor.getState();
    expect(state.nodes.some((n) => n.id === a.id)).toBe(false);
    expect(state.edges).toHaveLength(0); // edge touching the removed node is dropped
  });

  it("clears the inspector when the selected node is removed remotely", () => {
    const node = addNode();
    useEditor.getState().selectNode(node.id);
    expect(useEditor.getState().selectedNodeId).toBe(node.id);
    apply([{ t: "remove", nodeIds: [node.id] }]);
    expect(useEditor.getState().selectedNodeId).toBeNull();
  });

  it("replaces the whole graph (undo/redo from a peer) while keeping local selection", () => {
    const a = addNode();
    useEditor.getState().selectNode(a.id);
    apply([
      {
        t: "replace",
        nodes: [
          { id: a.id, position: { x: 0, y: 0 }, data: a.data as Record<string, unknown> },
          { id: "n2", position: { x: 50, y: 0 }, data: { nodeType: "output.response", title: "Out", config: {} } },
        ],
        edges: [{ id: "e1", source: a.id, target: "n2" }],
      },
    ]);
    const state = useEditor.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(1);
    expect(state.nodes.find((n) => n.id === a.id)?.selected).toBe(true);
  });

  it("ignores remote edits while previewing a read-only version", () => {
    const node = addNode();
    // Simulate a version preview being open.
    useEditor.setState({ previewVersion: { id: "v1" } as never });
    apply([{ t: "move", positions: [{ id: node.id, x: 999, y: 999 }] }]);
    const unchanged = useEditor.getState().nodes.find((n) => n.id === node.id);
    expect(unchanged?.position).toEqual({ x: 0, y: 0 });
  });
});
