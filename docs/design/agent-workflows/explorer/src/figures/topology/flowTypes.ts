import type { Node, Edge } from "@xyflow/react";
import type { NodeTier, NodeStatus } from "../../model/types";

export interface TopoNodeData extends Record<string, unknown> {
  label: string;
  tier: NodeTier;
  status: NodeStatus;
  aliasHint?: string;
  dimmed: boolean;
  spotlit: boolean;
  selected: boolean;
  /** Hovered, or selected in F1 (SidePanel click) -- highlights this node's own secondary edges. */
  active: boolean;
}

export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  tier: NodeTier;
  dimmed: boolean;
}

export interface TopoEdgeData extends Record<string, unknown> {
  dimmed: boolean;
  spotlit: boolean;
  animate: boolean;
  /** "spine" = the primary browser->...->harness request path, always prominent. */
  kind: "spine" | "secondary";
  /** A secondary edge reads at full ink when hovering/selecting either endpoint node, or the edge itself. */
  active: boolean;
}

export type TopoNode = Node<TopoNodeData, "topoNode">;
export type GroupBoxNode = Node<GroupNodeData, "groupBox">;
export type TopoEdge = Edge<TopoEdgeData>;

/** Drives which nodes/edges read as "in play" vs. background, shared by F1 and F2. */
export interface HighlightSpec {
  nodeIds: string[];
  edgeIds: string[];
}
