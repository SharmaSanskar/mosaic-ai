"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createClient } from "@/lib/supabase/client";
import { useRoomSocketContext } from "@/lib/room-socket-context";
import { layoutGraph, NODE_TYPE_LEGEND } from "@/lib/graph-layout";
import type { GraphState } from "@/lib/types";

interface GraphPaneProps {
  roomId: string;
}

const EMPTY_GRAPH: GraphState = { nodes: [], edges: [] };

export function GraphPane({ roomId }: GraphPaneProps) {
  const [graph, setGraph] = useState<GraphState>(EMPTY_GRAPH);
  const { on } = useRoomSocketContext();

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("rooms")
      .select("graph_state")
      .eq("id", roomId)
      .maybeSingle<{ graph_state: GraphState }>()
      .then(({ data }) => {
        if (data?.graph_state) setGraph(data.graph_state);
      });
  }, [roomId]);

  useEffect(() => {
    return on("GRAPH_UPDATE", (payload) => {
      setGraph(payload as GraphState);
    });
  }, [on]);

  const { nodes, edges } = useMemo(
    () => layoutGraph(graph.nodes, graph.edges),
    [graph],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-y-1 border-b px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Reasoning graph</h2>
        <div className="flex items-center gap-2.5">
          {NODE_TYPE_LEGEND.map((item) => (
            <span key={item.type} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            No graph yet — tag @AI in chat and one will build itself here.
          </div>
        ) : (
          <ReactFlowProvider>
            <GraphCanvas nodes={nodes} edges={edges} />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}

function GraphCanvas({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const id = requestAnimationFrame(() => fitView({ duration: 200 }));
    return () => cancelAnimationFrame(id);
  }, [nodes, edges, fitView]);

  return (
    <ReactFlow nodes={nodes} edges={edges} fitView>
      <Background />
      <Controls />
    </ReactFlow>
  );
}
