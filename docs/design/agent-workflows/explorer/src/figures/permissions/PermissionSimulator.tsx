/**
 * F3 - Permission simulator. One shared state object (PermSimState) driving
 * three coordinated panels (TensorFlow Playground pattern): knobs on the
 * left write the policy, the tool palette in the middle composes a call, the
 * outcome panel on the right only reads decide()'s result and renders which
 * rung of the ladder decided and which gate enforces it.
 *
 * decide() itself lives in ./decide.ts and is exercised against every
 * permissions.json testVector in ./decide.test.ts; this component is a thin,
 * stateful harness around that pure function plus the HITL pause/approve/
 * resume loop.
 */
import { useRef, useState } from "react";
import { permissionsModel } from "../../model";
import type { ToolExample } from "../../model/types";
import {
  decide,
  decideClientTool,
  KILL_SWITCH_ENV_VAR,
  piBuiltinIdentity,
  planFromConfig,
  StoredDecisionStore,
  type GateDescriptor,
} from "./decide";
import { KnobsPanel } from "./KnobsPanel";
import { ToolPalette } from "./ToolPalette";
import { OutcomePanel } from "./OutcomePanel";
import { initialPermSimState, type CallState, type ToolOverride } from "./permSimTypes";
import { FigureFrame } from "../shared/FigureFrame";
import "./permissions.css";

/**
 * A realistic server-tool wire name for the "mcp" tool example, taken from
 * permissions.json's own TV7 test vector rather than hardcoded here, so this
 * demo name can never drift from the model it is meant to illustrate.
 */
const MCP_EXAMPLE_TOOL_NAME =
  permissionsModel.testVectors.find((v) => v.id === "TV7")?.gate.toolName ?? "github_list_issues";

/** The wire-shaped, Claude-settings-style rule name a gate matches rules against. */
function gateToolName(tool: ToolExample): string {
  const identity = piBuiltinIdentity(tool.name);
  if (identity) return identity.ruleName;
  if (tool.kind === "mcp") return MCP_EXAMPLE_TOOL_NAME;
  return tool.name;
}

function buildGate(tool: ToolExample, override: ToolOverride, bashCommand: string): GateDescriptor {
  const toolName = gateToolName(tool);
  const readOnlyHint = typeof tool.readOnlyHint === "boolean" ? tool.readOnlyHint : undefined;
  const args = tool.name === "bash" ? { command: bashCommand } : undefined;
  const gate: GateDescriptor = { toolName, readOnlyHint, args };
  if (override !== "inherit") {
    if (tool.kind === "mcp") gate.serverPermission = override;
    else gate.specPermission = override;
  }
  return gate;
}

export function PermissionSimulator() {
  const [state, setState] = useState(initialPermSimState);
  const [callState, setCallState] = useState<CallState | undefined>(undefined);
  const storeRef = useRef(new StoredDecisionStore());

  const tools = permissionsModel.toolExamples;

  function currentPlan() {
    return planFromConfig({
      permissions: { default: state.policyDefault, rules: state.rules },
      env: state.killSwitch ? { [KILL_SWITCH_ENV_VAR]: "true" } : undefined,
    });
  }

  function handleCallTool() {
    const tool = tools.find((t) => t.name === state.selectedTool);
    if (!tool) return;
    const override = state.overrides[tool.name] ?? "inherit";
    const gate = buildGate(tool, override, state.bashCommand);

    if (tool.kind === "client") {
      const { plan } = currentPlan();
      const verdict = decideClientTool(gate, plan, storeRef.current);
      setCallState({ gate, tool, verdict, planRung: "normal", plan, resumed: undefined });
      return;
    }

    const { plan, rung: planRung } = currentPlan();
    const verdict = decide(gate, plan, storeRef.current);
    setCallState({ gate, tool, verdict, planRung, plan, resumed: undefined });
  }

  function resolveHitl(decision: "allow" | "deny") {
    setCallState((prev) => {
      if (!prev || prev.verdict.kind !== "pendingApproval") return prev;
      storeRef.current.record(prev.gate.toolName, prev.gate.args, decision);
      // Resume against the plan snapshot taken at "Call tool" time, NOT
      // currentPlan(): the knobs (e.g. the kill switch) can change while the
      // call sits paused, but the resume is answering the ask that was
      // actually raised, not a fresh one under today's knobs.
      const resumedVerdict =
        prev.tool.kind === "client"
          ? decideClientTool(prev.gate, prev.plan, storeRef.current)
          : decide(prev.gate, prev.plan, storeRef.current);
      return { ...prev, resumed: { decision, verdict: resumedVerdict } };
    });
  }

  return (
    <FigureFrame>
      <div className="figure-shell perm-sim">
        <div className="figure-toolbar">
          <span>F3 &middot; Permission simulator</span>
          <span className="perm-source-note mono">{permissionsModel.sourceOfTruth}</span>
        </div>

        <div className="perm-sim-body">
          <KnobsPanel
            harness={state.harness}
            onHarnessChange={(harness) => setState((s) => ({ ...s, harness }))}
            policyDefaults={permissionsModel.policyDefaults}
            policyDefault={state.policyDefault}
            onPolicyChange={(policyDefault) => setState((s) => ({ ...s, policyDefault }))}
            rules={state.rules}
            onRulesChange={(rules) => setState((s) => ({ ...s, rules }))}
            killSwitch={state.killSwitch}
            onKillSwitchChange={(killSwitch) => setState((s) => ({ ...s, killSwitch }))}
            killSwitchEnvVar={permissionsModel.killSwitch.envVar}
          />

          <ToolPalette
            tools={tools}
            overrides={state.overrides}
            onOverrideChange={(toolName, value) =>
              setState((s) => ({ ...s, overrides: { ...s.overrides, [toolName]: value } }))
            }
            selectedTool={state.selectedTool}
            onSelectTool={(selectedTool) => setState((s) => ({ ...s, selectedTool }))}
            bashCommand={state.bashCommand}
            onBashCommandChange={(bashCommand) => setState((s) => ({ ...s, bashCommand }))}
            onCallTool={handleCallTool}
          />

          <OutcomePanel
            precedence={permissionsModel.precedence}
            gates={permissionsModel.gates}
            citations={permissionsModel.citations}
            harness={state.harness}
            call={callState}
            onApprove={() => resolveHitl("allow")}
            onDeny={() => resolveHitl("deny")}
          />
        </div>
      </div>
    </FigureFrame>
  );
}
