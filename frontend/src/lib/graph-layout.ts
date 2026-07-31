import type { Edge, Node } from "@xyflow/react";
import type { GraphEdge, GraphNode } from "@/lib/types";

const COLUMN_WIDTH = 200;
const ROW_HEIGHT = 120;

// Validated via the dataviz skill's validate_palette.js (light mode,
// --pairs all): worst adjacent normal-vision ΔE 16.3, one WARN on teal's
// contrast — mitigated since every node always carries a visible text
// label, never color alone. See NODE_TYPE_LEGEND for the same 4 types.
export const NODE_TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  topic: { bg: "#eaf2fc", border: "#2a78d6", text: "#0d3868" },
  question: { bg: "#e6f7f0", border: "#1baf7a", text: "#0a4a34" },
  decision: { bg: "#efecfa", border: "#4a3aa7", text: "#2c2264" },
  action: { bg: "#fdece2", border: "#eb6834", text: "#7a2e10" },
};
const DEFAULT_NODE_COLOR = { bg: "#f4f4f4", border: "#a3a3a3", text: "#404040" };

export const NODE_TYPE_LEGEND = [
  { type: "topic", label: "Topic", color: "#2a78d6" },
  { type: "question", label: "Question", color: "#1baf7a" },
  { type: "decision", label: "Decision", color: "#4a3aa7" },
  { type: "action", label: "Action", color: "#eb6834" },
];

// Simple layered layout: level(node) = 1 + max(level(parent)) over incoming
// edges, relaxed iteratively (capped to node count so a cycle can't loop
// forever). Nodes in the same level are spread left-to-right.
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: Node[]; edges: Edge[] } {
  const level = new Map<string, number>();
  nodes.forEach((n) => level.set(n.id, 0));

  for (let i = 0; i < nodes.length; i++) {
    let changed = false;
    for (const e of edges) {
      const sourceLevel = level.get(e.source);
      const targetLevel = level.get(e.target);
      if (sourceLevel === undefined || targetLevel === undefined) continue;
      if (targetLevel < sourceLevel + 1) {
        level.set(e.target, sourceLevel + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columnCounts = new Map<number, number>();
  const rfNodes: Node[] = nodes.map((n) => {
    const lvl = level.get(n.id) ?? 0;
    const col = columnCounts.get(lvl) ?? 0;
    columnCounts.set(lvl, col + 1);
    const colors = NODE_TYPE_COLORS[n.type ?? ""] ?? DEFAULT_NODE_COLOR;
    return {
      id: n.id,
      position: { x: col * COLUMN_WIDTH, y: lvl * ROW_HEIGHT },
      data: { label: n.label },
      style: {
        background: colors.bg,
        border: `2px solid ${colors.border}`,
        color: colors.text,
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 500,
        padding: "6px 10px",
      },
    };
  });

  const rfEdges: Edge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
  }));

  return { nodes: rfNodes, edges: rfEdges };
}
