import type { Citation, PermissionGate, PermissionPrecedenceStep } from "../../model/types";
import type { DecidingRung, Verdict } from "./decide";
import type { CallState, Harness } from "./permSimTypes";
import { CitationList } from "../shared/CitationList";

export interface OutcomePanelProps {
  precedence: PermissionPrecedenceStep[];
  gates: PermissionGate[];
  citations: Citation[];
  harness: Harness;
  call: CallState | undefined;
  onApprove: () => void;
  onDeny: () => void;
}

/** Claude pre-answers from settings.json whenever the ladder resolved something other than "ask"; the ACP responder is the fallback gate for anything left unset. */
function claudeGate(verdict: Verdict): "settings-file" | "acp-responder" {
  return verdict.effectivePermission === "ask" ? "acp-responder" : "settings-file";
}

function verdictLabel(kind: Verdict["kind"], isClientTool: boolean): string {
  if (kind === "allow") return "allow";
  if (kind === "deny") return "deny";
  return isClientTool ? "pendingApproval -> browser" : "ask -> pendingApproval";
}

export function OutcomePanel({ precedence, gates, citations, harness, call, onApprove, onDeny }: OutcomePanelProps) {
  const verdict = call?.resumed?.verdict ?? call?.verdict;
  const litRung: DecidingRung | "storedDecision" | undefined = verdict?.rung;
  const litGateId: string = call ? (harness === "pi" ? "relay" : claudeGate(call.verdict)) : "";
  const pendingRaw = call && call.verdict.kind === "pendingApproval" && !call.resumed;
  const isClientTool = call?.tool.kind === "client";

  return (
    <div className="perm-panel perm-outcome">
      <h3>Outcome</h3>

      {!call && <p className="empty-hint">Pick a tool on the left and click "Call" to run decide().</p>}

      {call && (
        <>
          <div className="perm-verdict-row">
            <span className="perm-verdict-badge" data-kind={verdict?.kind}>
              {verdictLabel(verdict?.kind ?? call.verdict.kind, isClientTool)}
            </span>
            <span className="perm-verdict-tool mono">
              {call.tool.name} ({call.gate.toolName})
            </span>
          </div>

          {call.planRung !== "normal" && (
            <p className="perm-plan-note">
              Plan construction: <strong>{call.planRung === "killSwitch" ? "kill switch forced deny" : "malformed config fell back to ask"}</strong>{" "}
              before any single gate was even considered.
            </p>
          )}

          <div className="field-label">Precedence ladder</div>
          <ol className="perm-ladder">
            {precedence.map((step) => (
              <li key={step.id} className="perm-ladder-step" data-active={litRung === step.id}>
                <span className="perm-ladder-step-id">
                  {step.step}. {step.id}
                </span>
                <span className="perm-ladder-step-desc">{step.description}</span>
              </li>
            ))}
            <li className="perm-ladder-step" data-active={litRung === "storedDecision"}>
              <span className="perm-ladder-step-id">&rarr; stored decision</span>
              <span className="perm-ladder-step-desc">
                An "ask" verdict consults a decision recorded earlier this conversation before pausing; consumed
                once.
              </span>
            </li>
          </ol>

          <p className="perm-detail-line">{verdict?.detail}</p>

          <div className="field-label">Enforcement gate ({harness})</div>
          <div className="perm-gate-diagram" data-harness={harness}>
            {harness === "claude" ? (
              <>
                <div className="perm-gate-box" data-lit={litGateId === "settings-file"}>
                  <strong>Gate 1</strong>
                  <span>.claude/settings.json (pre-answered)</span>
                </div>
                <div className="perm-gate-arrow">&rarr;</div>
                <div className="perm-gate-box" data-lit={litGateId === "acp-responder"}>
                  <strong>Gate 2</strong>
                  <span>ACP approval responder</span>
                </div>
              </>
            ) : (
              <div className="perm-gate-box" data-lit>
                <strong>Tool relay</strong>
                <span>single enforcement point for Pi (builtins, gateway, code, platform)</span>
              </div>
            )}
          </div>

          {pendingRaw && (
            <div className="perm-hitl-banner" role="alert">
              <p>
                {isClientTool ? (
                  <>
                    <strong>Forwarded to the browser to fulfill.</strong> Client tools have no local "allow"; the
                    turn pauses and a human on the browser side answers on a later turn.
                  </>
                ) : (
                  <>
                    <strong>Turn paused.</strong> stopReason: "paused" &middot; emitted one
                    interaction_request(user_approval) event.
                  </>
                )}
              </p>
              <div className="perm-hitl-actions">
                <button type="button" className="perm-approve" onClick={onApprove}>
                  Approve
                </button>
                <button type="button" className="perm-deny" onClick={onDeny}>
                  Deny
                </button>
              </div>
            </div>
          )}

          {call.resumed && (
            <div className="perm-resume-note">
              <p>
                Harness re-issues the call. Anchor match on <code>(toolName, canonicalizedArgs)</code> finds the
                stored <strong>{call.resumed.decision}</strong> decision and consumes it (one use). Verdict now:{" "}
                <strong>{verdictLabel(call.resumed.verdict.kind, isClientTool)}</strong>. Calling the same tool with the same
                arguments again will ask again.
              </p>
            </div>
          )}
        </>
      )}

      <div className="field-label" style={{ marginTop: "1.25rem" }}>
        Gates (full model)
      </div>
      <ul className="perm-gate-list">
        {gates.map((gate) => (
          <li key={gate.id}>
            <strong>{gate.label}</strong>
            <span className="perm-gate-applies">{gate.appliesTo.join(", ")}</span>
          </li>
        ))}
      </ul>

      <div className="field-label" style={{ marginTop: "1.25rem" }}>
        Citations
      </div>
      <CitationList citations={citations} />
    </div>
  );
}
