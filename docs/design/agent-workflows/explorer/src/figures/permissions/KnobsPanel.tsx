import type { PermissionRule } from "./decide";
import type { PolicyDefault } from "../../model/types";
import type { Harness } from "./permSimTypes";
import { nodeById } from "../../model";

export interface KnobsPanelProps {
  harness: Harness;
  onHarnessChange: (harness: Harness) => void;
  policyDefaults: PolicyDefault[];
  policyDefault: PolicyDefault;
  onPolicyChange: (policy: PolicyDefault) => void;
  rules: PermissionRule[];
  onRulesChange: (rules: PermissionRule[]) => void;
  killSwitch: boolean;
  onKillSwitchChange: (value: boolean) => void;
  killSwitchEnvVar: string;
}

const TOOL_PERMISSIONS = ["allow", "ask", "deny"] as const;

/**
 * "pi (pi_core / pi_agenta)": derived from the harness-pi node's own aliases
 * in nodes.json rather than hardcoded, so this label can't drift from the
 * model it is illustrating. Aliases are free-text prose (e.g. "pi_agenta
 * (same CLI, forced extras)"); only the leading pi_-prefixed token of each
 * is kept.
 */
function piHarnessLabel(): string {
  const node = nodeById("harness-pi");
  const aliases = (node?.aliases ?? [])
    .map((alias) => alias.match(/^[\w@./-]+/)?.[0])
    .filter((token): token is string => Boolean(token) && token!.startsWith("pi_"));
  return aliases.length > 0 ? `pi (${aliases.join(" / ")})` : "pi";
}

const PI_HARNESS_LABEL = piHarnessLabel();

export function KnobsPanel({
  harness,
  onHarnessChange,
  policyDefaults,
  policyDefault,
  onPolicyChange,
  rules,
  onRulesChange,
  killSwitch,
  onKillSwitchChange,
  killSwitchEnvVar,
}: KnobsPanelProps) {
  function updateRule(index: number, patch: Partial<PermissionRule>) {
    onRulesChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  function removeRule(index: number) {
    onRulesChange(rules.filter((_, i) => i !== index));
  }

  function addRule() {
    onRulesChange([...rules, { pattern: "", permission: "ask" }]);
  }

  return (
    <div className="perm-panel perm-knobs">
      <h3>Policy knobs</h3>

      <div className="field-label">Harness</div>
      <div className="perm-toggle-row" role="radiogroup" aria-label="Harness">
        {(["pi", "claude"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="perm-toggle"
            data-active={harness === option}
            role="radio"
            aria-checked={harness === option}
            onClick={() => onHarnessChange(option)}
          >
            {option === "pi" ? PI_HARNESS_LABEL : "claude"}
          </button>
        ))}
      </div>

      <div className="field-label">Policy default (permissions.default)</div>
      <select
        className="perm-select"
        name="policyDefault"
        value={policyDefault}
        onChange={(e) => onPolicyChange(e.target.value as PolicyDefault)}
        aria-label="Policy default"
      >
        {policyDefaults.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>

      <div className="field-label">Authored rules (runner.permissions.rules)</div>
      <div className="perm-rule-list">
        {rules.map((rule, index) => (
          <div className="perm-rule-row" key={index}>
            <input
              className="perm-rule-pattern"
              name={`rule-pattern-${index}`}
              value={rule.pattern}
              placeholder='e.g. Bash(rm:*) or "Read"'
              onChange={(e) => updateRule(index, { pattern: e.target.value })}
              aria-label={`Rule ${index + 1} pattern`}
            />
            <select
              className="perm-select"
              name={`rule-permission-${index}`}
              value={rule.permission}
              onChange={(e) => updateRule(index, { permission: e.target.value as PermissionRule["permission"] })}
              aria-label={`Rule ${index + 1} permission`}
            >
              {TOOL_PERMISSIONS.map((permission) => (
                <option key={permission} value={permission}>
                  {permission}
                </option>
              ))}
            </select>
            <button type="button" className="perm-rule-remove" onClick={() => removeRule(index)} aria-label={`Remove rule ${index + 1}`}>
              &times;
            </button>
          </div>
        ))}
        {rules.length === 0 && <p className="empty-hint">No authored rules. Step 3 will never match.</p>}
      </div>
      <button type="button" className="perm-add-rule" onClick={addRule}>
        + add rule
      </button>

      <div className="field-label">Kill switch</div>
      <label className="perm-kill-switch">
        <input
          type="checkbox"
          name="killSwitch"
          checked={killSwitch}
          onChange={(e) => onKillSwitchChange(e.target.checked)}
        />
        <span>
          <code>{killSwitchEnvVar}=true</code>
        </span>
      </label>
      {killSwitch && (
        <p className="perm-kill-note">
          Forces the plan default to <code>deny</code> before the request's permissions are even read. An explicit
          per-tool <code>allow</code> still wins (step 1 runs before the plan default is consulted).
        </p>
      )}
    </div>
  );
}
