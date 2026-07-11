import { nodeById, edgeById } from "../../model";
import { CitationList } from "../shared/CitationList";

export function SidePanel({ selectedId }: { selectedId: string | null }) {
  if (!selectedId) {
    return (
      <div className="figure-sidepanel" aria-live="polite">
        <p className="empty-hint">Click a node or an edge to see its role, owner, and source.</p>
      </div>
    );
  }

  const node = nodeById(selectedId);
  if (node) {
    return (
      <div className="figure-sidepanel" aria-live="polite">
        <h3>{node.label}</h3>
        <div className="chip-row">
          <span className="chip">{node.tier}</span>
          <span className="chip">{node.status}</span>
        </div>

        <div className="field-label">Role</div>
        <p>{node.role}</p>

        {node.owns.length > 0 && (
          <>
            <div className="field-label">Owns</div>
            <ul>
              {node.owns.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}

        <div className="field-label">Code path</div>
        <CitationList citations={[{ codePath: node.codePath }]} />

        <div className="field-label">Doc path</div>
        <CitationList citations={[{ docPath: node.docPath }]} />

        <div className="field-label">Notes</div>
        <p>{node.notes}</p>

        {node.aliases.length > 0 && (
          <>
            <div className="field-label">Aliases</div>
            <div className="chip-row">
              {node.aliases.map((a) => (
                <span className="chip" key={a}>
                  {a}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const edge = edgeById(selectedId);
  if (edge) {
    return (
      <div className="figure-sidepanel" aria-live="polite">
        <h3>{edge.label}</h3>
        <div className="chip-row">
          <span className="chip">{edge.protocol}</span>
        </div>

        <div className="field-label">From &rarr; to</div>
        <p>
          {edge.from} &rarr; {edge.to}
        </p>

        <div className="field-label">Notes</div>
        <p>{edge.notes}</p>

        <div className="field-label">Doc path</div>
        <CitationList citations={[{ docPath: edge.docPath }]} />
      </div>
    );
  }

  return (
    <div className="figure-sidepanel" aria-live="polite">
      <p className="empty-hint">Nothing selected.</p>
    </div>
  );
}
