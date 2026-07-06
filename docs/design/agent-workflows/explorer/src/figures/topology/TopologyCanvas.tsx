import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildTopologyFlow, type BuildFlowOptions } from "./buildFlow";
import { TopoNode } from "./TopoNode";
import { GroupNode } from "./GroupNode";
import { TopoEdge } from "./TopoEdge";

const nodeTypes = { topoNode: TopoNode, groupBox: GroupNode };
const edgeTypes = { topoEdge: TopoEdge };

export interface TopologyCanvasProps extends BuildFlowOptions {
  selectedId?: string | null;
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
  onPaneClick?: () => void;
}

export function TopologyCanvas({
  selectedId = null,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  ...flowOptions
}: TopologyCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Hover wins over click-to-select while the pointer is over the canvas;
  // selecting a node (F1's SidePanel click) keeps its secondary edges
  // un-muted afterward too, so "click a node" also answers "what else does
  // this thing talk to".
  const activeNodeId = hoveredNodeId ?? selectedId ?? null;
  const activeEdgeId = hoveredEdgeId;

  const { nodes, edges } = useMemo(
    () => buildTopologyFlow({ ...flowOptions, activeNodeId, activeEdgeId }, selectedId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      flowOptions.mode,
      flowOptions.highlight,
      flowOptions.dimOthers,
      flowOptions.spotlight,
      selectedId,
      activeNodeId,
      activeEdgeId,
    ],
  );

  // React Flow's `fitView` prop only fits once, on mount. Re-fit whenever
  // this canvas's own box actually changes size -- the full-bleed figure
  // breakout resizing at a viewport breakpoint, entering/exiting
  // fullscreen, or the window resizing -- so the graph never sits
  // letterboxed inside a since-grown card.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      rfRef.current?.fitView({ duration: 200 });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.15}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll={false}
        onInit={(instance) => {
          rfRef.current = instance;
        }}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
        onEdgeClick={(_, edge) => onEdgeClick?.(edge.id)}
        onPaneClick={() => onPaneClick?.()}
        onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
        onNodeMouseLeave={() => setHoveredNodeId(null)}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
