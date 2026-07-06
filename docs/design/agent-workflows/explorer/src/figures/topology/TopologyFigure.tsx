import { useState } from "react";
import { TopologyCanvas } from "./TopologyCanvas";
import { SidePanel } from "./SidePanel";
import { FigureFrame } from "../shared/FigureFrame";

export interface TopologyFigureProps {
  mode?: "default" | "gaps";
  /** Show the default/gaps toggle button. Off for the fixed §7 "gaps" figure. */
  allowModeToggle?: boolean;
}

export function TopologyFigure({ mode = "default", allowModeToggle = true }: TopologyFigureProps) {
  const [localMode, setLocalMode] = useState(mode);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <FigureFrame>
      <div className="figure-shell">
        <div className="figure-toolbar">
          <span>F1 &middot; System topology</span>
          {allowModeToggle && (
            <div className="step-controls">
              <button
                onClick={() => setLocalMode(localMode === "gaps" ? "default" : "gaps")}
                aria-pressed={localMode === "gaps"}
              >
                {localMode === "gaps" ? "Showing gaps only" : "Spotlight what's not real yet"}
              </button>
            </div>
          )}
        </div>
        <div className="figure-canvas-row">
          <div className="figure-canvas">
            <TopologyCanvas
              mode={localMode}
              selectedId={selectedId}
              onNodeClick={setSelectedId}
              onEdgeClick={setSelectedId}
              onPaneClick={() => setSelectedId(null)}
            />
          </div>
          <SidePanel selectedId={selectedId} />
        </div>
      </div>
    </FigureFrame>
  );
}
