import { Section, ProseTk, FigureBreak } from "./Section";
import { TopologyFigure } from "../figures/topology/TopologyFigure";

export function Section01Map() {
  return (
    <Section id="s1-map" index="1 / The map" title="The map">
      <ProseTk>
        The request crosses five tiers below, left to right: edge, service, runner, and sandbox
        carry it directly. A platform tier off to the side holds shared pieces like tool
        execution and tracing.
      </ProseTk>
      <ProseTk>
        One naming note: older docs call the runner tier "sandbox-agent". This article says
        "runner"; the map keeps the old name as an alias.
      </ProseTk>
      <ProseTk>
        Click any box for its role and its code and doc links. Solid means the code runs today.
        Dotted means it runs but its content is a placeholder. Dashed and faded marks a gap:
        described but not built. Section 7 covers every dashed box.
      </ProseTk>
      <div className="legend-row">
        <span>
          <span className="legend-swatch" style={{ borderStyle: "solid" }} /> real
        </span>
        <span>
          <span className="legend-swatch" style={{ borderStyle: "dotted" }} /> experimental
        </span>
        <span>
          <span className="legend-swatch" style={{ borderStyle: "dashed", opacity: 0.65 }} /> gap
        </span>
      </div>
      <FigureBreak>
        <TopologyFigure mode="default" />
      </FigureBreak>
      <ProseTk>
        Now follow the request's first full trip: one call to <code>POST /invoke</code>, edge to
        harness and back.
      </ProseTk>
    </Section>
  );
}
