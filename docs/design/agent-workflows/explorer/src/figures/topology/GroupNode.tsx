import type { NodeProps } from "@xyflow/react";
import type { GroupBoxNode } from "./flowTypes";

export function GroupNode({ data }: NodeProps<GroupBoxNode>) {
  return (
    <div
      className="topo-group-node"
      data-tier={data.tier}
      data-dimmed={data.dimmed}
      style={{ width: "100%", height: "100%", position: "relative", opacity: data.dimmed ? 0.35 : 1 }}
    >
      <div className="topo-group-label">{data.label}</div>
    </div>
  );
}
