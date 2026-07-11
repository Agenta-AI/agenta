import { useMemo } from "react";
import { Differ, Viewer } from "json-diff-kit";
import "json-diff-kit/dist/viewer.css";
import type { Citation } from "../../model/types";
import { CitationList } from "../shared/CitationList";

const differ = new Differ({ detectCircular: true, showModifications: true, arrayDiffMethod: "lcs" });

export interface PayloadInspectorProps {
  previousPayload: unknown;
  payload: unknown;
  changedKeys: string[];
  citations: Citation[];
}

export function PayloadInspector({ previousPayload, payload, changedKeys, citations }: PayloadInspectorProps) {
  const diff = useMemo(() => differ.diff(previousPayload, payload), [previousPayload, payload]);

  return (
    <div className="payload-inspector">
      <div className="field-label">Payload (diff vs. previous step)</div>
      <div className="diff-scroll">
        <Viewer diff={diff} indent={2} lineNumbers={false} highlightInlineDiff syntaxHighlight={false} />
      </div>

      {changedKeys.length > 0 && (
        <>
          <div className="field-label" style={{ marginTop: "1rem" }}>
            Changed keys
          </div>
          <div className="chip-row">
            {changedKeys.map((key) => (
              <span className="chip" key={key}>
                {key}
              </span>
            ))}
          </div>
        </>
      )}

      {citations.length > 0 && (
        <>
          <div className="field-label" style={{ marginTop: "1rem" }}>
            Citations
          </div>
          <CitationList citations={citations} />
        </>
      )}
    </div>
  );
}
