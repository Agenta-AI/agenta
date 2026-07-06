import { MarkerType } from "@xyflow/react";
import { nodes, edges } from "../../model";
import positionsJson from "./positions.json";
import { GROUP_META, ALIAS_HINTS, SPINE_EDGE_IDS } from "./groups";
import type { TopoNode, GroupBoxNode, TopoEdge, HighlightSpec } from "./flowTypes";

interface PositionEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

const positions = positionsJson as Record<string, PositionEntry>;

export interface BuildFlowOptions {
  mode?: "default" | "gaps";
  /** Rendered at normal opacity; everything else dims if dimOthers is set. */
  highlight?: HighlightSpec;
  dimOthers?: boolean;
  /** The single current step's node/edge, if any: gets the extra glow. */
  spotlight?: { nodeId?: string; edgeId?: string };
  /** Hover (or F1's click-to-select) target: un-mutes secondary edges touching it. F1 only. */
  activeNodeId?: string | null;
  activeEdgeId?: string | null;
}

function nodeVisualState(
  id: string,
  status: string,
  opts: BuildFlowOptions,
): { dimmed: boolean; spotlit: boolean; active: boolean } {
  const active = opts.activeNodeId === id;
  if (opts.mode === "gaps") {
    const isGap = status !== "real";
    return { dimmed: !isGap, spotlit: isGap, active };
  }
  const inHighlight = opts.highlight?.nodeIds.includes(id) ?? false;
  const dimmed = Boolean(opts.dimOthers) && opts.highlight !== undefined && !inHighlight;
  const spotlit = opts.spotlight?.nodeId === id;
  return { dimmed, spotlit, active };
}

function edgeVisualState(
  id: string,
  from: string,
  to: string,
  fromStatus: string,
  toStatus: string,
  opts: BuildFlowOptions,
): { dimmed: boolean; spotlit: boolean; active: boolean; kind: "spine" | "secondary" } {
  const kind = SPINE_EDGE_IDS.has(id) ? "spine" : "secondary";
  const active =
    opts.activeEdgeId === id || opts.activeNodeId === from || opts.activeNodeId === to;
  if (opts.mode === "gaps") {
    const isGap = fromStatus !== "real" || toStatus !== "real";
    return { dimmed: !isGap, spotlit: isGap, active, kind };
  }
  const inHighlight = opts.highlight?.edgeIds.includes(id) ?? false;
  const dimmed = Boolean(opts.dimOthers) && opts.highlight !== undefined && !inHighlight;
  const spotlit = opts.spotlight?.edgeId === id;
  return { dimmed, spotlit, active, kind };
}

type Side = "top" | "bottom" | "left" | "right";

/**
 * positions.json gives grouped children's x/y RELATIVE to their group box
 * (React Flow's convention whenever parentId is set), so comparing a
 * grouped child's raw x/y against an ungrouped node's would be comparing
 * different coordinate spaces. Walk the (at most one level deep) parentId
 * chain to get a real page-space center for the handle-side heuristic.
 */
function centerOf(id: string): { x: number; y: number } | undefined {
  const pos = positions[id];
  if (!pos) return undefined;
  let x = pos.x + pos.width / 2;
  let y = pos.y + pos.height / 2;
  let parentId = pos.parentId;
  while (parentId) {
    const parentPos = positions[parentId];
    if (!parentPos) break;
    x += parentPos.x;
    y += parentPos.y;
    parentId = parentPos.parentId;
  }
  return { x, y };
}

/**
 * A handful of edges the automatic dx/dy heuristic below gets wrong: they
 * live inside the cramped grp-runner grid, where the "bigger gap wins" rule
 * picks a horizontal approach that would visually clip through a node
 * sitting in the same row between the two endpoints. Hand-picked after
 * visually checking the rendered graph, same as positions.json itself.
 */
const HANDLE_OVERRIDES: Record<string, { sourceHandle: Side; targetHandle: Side }> = {
  // daemon (row 1) -> acp-claude (row 2, one column over): the dx/dy
  // heuristic prefers a horizontal approach, which would path across
  // acp-pi's row (row 1, sitting between them). Drop down from daemon
  // first instead, passing below acp-pi's row entirely.
  "e-daemon-acp-claude": { sourceHandle: "bottom", targetHandle: "top" },
};

/**
 * Picks which side of each node an edge should leave/enter from, purely
 * from the two nodes' frozen (absolute) positions: whichever axis has the
 * bigger gap wins, so edges approach a node from roughly the direction its
 * other end actually is instead of always left/right. Each TopoNode renders
 * both a source and a target Handle on all four sides (see TopoNode.tsx),
 * so any combination here always resolves to a real anchor point.
 */
function pickHandles(
  edgeId: string,
  fromId: string,
  toId: string,
): { sourceHandle: Side; targetHandle: Side } {
  const override = HANDLE_OVERRIDES[edgeId];
  if (override) return override;

  const fromCenter = centerOf(fromId);
  const toCenter = centerOf(toId);
  if (!fromCenter || !toCenter) return { sourceHandle: "right", targetHandle: "left" };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { sourceHandle: "right", targetHandle: "left" } : { sourceHandle: "left", targetHandle: "right" };
  }
  return dy >= 0 ? { sourceHandle: "bottom", targetHandle: "top" } : { sourceHandle: "top", targetHandle: "bottom" };
}

/**
 * Builds React Flow nodes/edges from the model + frozen positions, purely as
 * a function of (model, positions, options). No architecture facts are
 * hardcoded here beyond the two synthetic group boxes (groups.ts) and the
 * runner alias hint; everything else (labels, tiers, statuses, edges) reads
 * straight from src/model.
 */
export function buildTopologyFlow(
  opts: BuildFlowOptions,
  selectedId: string | null,
): { nodes: (TopoNode | GroupBoxNode)[]; edges: TopoEdge[] } {
  const rfNodes: (TopoNode | GroupBoxNode)[] = [];

  // Group boxes must be added before their children so children render on top.
  for (const [groupId, meta] of Object.entries(GROUP_META)) {
    const pos = positions[groupId];
    if (!pos) continue;
    rfNodes.push({
      id: groupId,
      type: "groupBox",
      position: { x: pos.x, y: pos.y },
      style: { width: pos.width, height: pos.height },
      width: pos.width,
      height: pos.height,
      draggable: false,
      selectable: false,
      zIndex: 0,
      data: {
        label: meta.label,
        tier: meta.tier,
        dimmed: opts.mode === "gaps",
      },
    });
  }

  for (const node of nodes) {
    const pos = positions[node.id];
    if (!pos) continue;
    const { dimmed, spotlit, active } = nodeVisualState(node.id, node.status, opts);
    rfNodes.push({
      id: node.id,
      type: "topoNode",
      position: { x: pos.x, y: pos.y },
      parentId: pos.parentId ?? undefined,
      extent: pos.parentId ? "parent" : undefined,
      style: { width: pos.width, height: pos.height },
      width: pos.width,
      height: pos.height,
      draggable: false,
      data: {
        label: node.label,
        tier: node.tier,
        status: node.status,
        aliasHint: ALIAS_HINTS[node.id],
        dimmed,
        spotlit,
        active,
        selected: selectedId === node.id,
      },
    });
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rfEdges: TopoEdge[] = [];
  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to || !positions[edge.from] || !positions[edge.to]) continue;
    const { dimmed, spotlit, active, kind } = edgeVisualState(
      edge.id,
      edge.from,
      edge.to,
      from.status,
      to.status,
      opts,
    );
    const { sourceHandle, targetHandle } = pickHandles(edge.id, edge.from, edge.to);
    rfEdges.push({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      sourceHandle,
      targetHandle,
      type: "topoEdge",
      selected: selectedId === edge.id,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      zIndex: kind === "spine" ? 1 : 0,
      data: {
        dimmed,
        spotlit,
        active,
        kind,
        animate: opts.spotlight?.edgeId === edge.id,
      },
    });
  }

  return { nodes: rfNodes, edges: rfEdges };
}
