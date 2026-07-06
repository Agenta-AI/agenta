import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { TopoNode as TopoNodeT } from "./flowTypes";

/**
 * One target + one source handle per side, all visually invisible (styled
 * in styles.css) and non-interactive (nodes aren't draggable/connectable in
 * this figure). buildFlow.ts's pickHandles() picks whichever side/id pair
 * best matches the two nodes' actual relative position, so edges leave and
 * arrive from a sensible side instead of every edge converging on the same
 * left/right pair -- the main lever against edges overlapping or cutting
 * through unrelated nodes.
 */
const SIDES: { side: "top" | "bottom" | "left" | "right"; position: Position }[] = [
  { side: "top", position: Position.Top },
  { side: "bottom", position: Position.Bottom },
  { side: "left", position: Position.Left },
  { side: "right", position: Position.Right },
];

export function TopoNode({ data }: NodeProps<TopoNodeT>) {
  return (
    <div
      className="topo-node"
      data-tier={data.tier}
      data-status={data.status}
      data-selected={data.selected}
      data-dimmed={data.dimmed}
      data-spotlit={data.spotlit}
      data-active={data.active}
    >
      {SIDES.map(({ side, position }) => (
        <Handle key={`t-${side}`} type="target" position={position} id={side} className="topo-handle" />
      ))}
      <div className="topo-node-label">{data.label}</div>
      {data.aliasHint && <div className="topo-node-alias">{data.aliasHint}</div>}
      {SIDES.map(({ side, position }) => (
        <Handle key={`s-${side}`} type="source" position={position} id={side} className="topo-handle" />
      ))}
    </div>
  );
}
