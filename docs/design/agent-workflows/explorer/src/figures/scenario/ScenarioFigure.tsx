import { useMemo, useRef } from "react";
import { scenarioById, edgeById } from "../../model";
import type { Scenario } from "../../model/types";
import { TopologyCanvas } from "../topology/TopologyCanvas";
import { useScenarioPlayer } from "./useScenarioPlayer";
import { StepControls } from "./StepControls";
import { PayloadInspector } from "./PayloadInspector";
import { FigureFrame } from "../shared/FigureFrame";
import type { HighlightSpec } from "../topology/flowTypes";

function computeParticipants(scenario: Scenario): HighlightSpec {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const step of scenario.steps) {
    if (step.nodeId) {
      nodeIds.add(step.nodeId);
    } else if (step.edgeId) {
      edgeIds.add(step.edgeId);
      const edge = edgeById(step.edgeId);
      if (edge) {
        nodeIds.add(edge.from);
        nodeIds.add(edge.to);
      }
    }
  }
  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds] };
}

function ScenarioPlayer({ scenario }: { scenario: Scenario }) {
  // Hooks run unconditionally, before the empty-scenario early return below,
  // so the rules of hooks hold even when there is nothing to play.
  const player = useScenarioPlayer(scenario);
  const participants = useMemo(() => computeParticipants(scenario), [scenario]);
  const shellRef = useRef<HTMLDivElement>(null);

  if (scenario.steps.length === 0) {
    return (
      <FigureFrame>
        <div
          className="figure-shell scenario-figure"
          ref={shellRef}
          aria-label={`Scenario: ${scenario.title}`}
        >
          <div className="figure-toolbar">
            <span>F2 &middot; {scenario.title}</span>
          </div>
          <p className="empty-hint" style={{ padding: "1rem" }}>
            This scenario has no steps yet.
          </p>
        </div>
      </FigureFrame>
    );
  }

  const spotlight = player.step.nodeId
    ? { nodeId: player.step.nodeId }
    : { edgeId: player.step.edgeId };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") player.next();
    if (e.key === "ArrowLeft") player.prev();
  }

  return (
    <FigureFrame className="scenario-frame">
      <div
        className="figure-shell scenario-figure"
        ref={shellRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={`Scenario: ${scenario.title}`}
      >
        <div className="figure-toolbar">
          <span>F2 &middot; {scenario.title}</span>
          <StepControls
            steps={scenario.steps}
            stepIndex={player.stepIndex}
            isPlaying={player.isPlaying}
            isFirstStep={player.isFirstStep}
            isLastStep={player.isLastStep}
            onPrev={player.prev}
            onNext={player.next}
            onTogglePlay={player.togglePlay}
            onGoTo={player.goTo}
          />
        </div>

        <div className="step-caption">
          <h4>{player.step.title}</h4>
          <p>{player.step.description}</p>
        </div>

        <div className="figure-canvas-row">
          <div className="figure-canvas">
            <TopologyCanvas
              mode="default"
              highlight={participants}
              dimOthers
              spotlight={spotlight}
            />
          </div>
          <PayloadInspector
            previousPayload={player.previousPayload}
            payload={player.step.payload}
            changedKeys={player.step.changedKeys}
            citations={player.step.citations}
          />
        </div>
      </div>
    </FigureFrame>
  );
}

export interface ScenarioFigureProps {
  scenarioId: string;
}

export function ScenarioFigure({ scenarioId }: ScenarioFigureProps) {
  const scenario = scenarioById(scenarioId);
  if (!scenario) {
    throw new Error(`ScenarioFigure: no scenario with id "${scenarioId}" in scenarios.json`);
  }
  // Remount the whole player when the scenario id changes (used for §4's
  // tabbed gateway-tool-call / daytona-tool-relay pair) so all step state
  // resets cleanly rather than needing to reconcile mismatched step counts.
  return <ScenarioPlayer key={scenario.id} scenario={scenario} />;
}
