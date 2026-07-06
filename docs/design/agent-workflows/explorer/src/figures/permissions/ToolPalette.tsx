import type { ToolExample } from "../../model/types";
import type { ToolOverride } from "./permSimTypes";

export interface ToolPaletteProps {
  tools: ToolExample[];
  overrides: Record<string, ToolOverride>;
  onOverrideChange: (toolName: string, value: ToolOverride) => void;
  selectedTool: string;
  onSelectTool: (toolName: string) => void;
  bashCommand: string;
  onBashCommandChange: (value: string) => void;
  onCallTool: () => void;
}

const OVERRIDE_OPTIONS: ToolOverride[] = ["inherit", "allow", "ask", "deny"];

function readOnlyBadge(hint: ToolExample["readOnlyHint"]) {
  if (hint === true) return <span className="chip perm-badge-readonly">read-only</span>;
  if (hint === false) return <span className="chip perm-badge-write">write</span>;
  return <span className="chip perm-badge-unknown">{hint === null ? "no hint" : String(hint)}</span>;
}

export function ToolPalette({
  tools,
  overrides,
  onOverrideChange,
  selectedTool,
  onSelectTool,
  bashCommand,
  onBashCommandChange,
  onCallTool,
}: ToolPaletteProps) {
  const selected = tools.find((t) => t.name === selectedTool);
  const overrideLabel = selected?.kind === "mcp" ? "Server permission override" : "Tool permission override";

  return (
    <div className="perm-panel perm-tools">
      <h3>Tool palette</h3>
      <div className="perm-tool-list">
        {tools.map((tool) => (
          <button
            type="button"
            key={tool.name}
            className="perm-tool-card"
            data-selected={tool.name === selectedTool}
            onClick={() => onSelectTool(tool.name)}
          >
            <div className="perm-tool-card-head">
              <span className="mono perm-tool-name">{tool.name}</span>
              <span className="chip perm-badge-kind">{tool.kind}</span>
            </div>
            <div className="perm-tool-card-badges">{readOnlyBadge(tool.readOnlyHint)}</div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="perm-tool-detail">
          <p className="perm-tool-notes">{selected.notes}</p>

          <div className="field-label">{overrideLabel}</div>
          <select
            className="perm-select"
            name="toolOverride"
            value={overrides[selected.name] ?? "inherit"}
            onChange={(e) => onOverrideChange(selected.name, e.target.value as ToolOverride)}
            aria-label={overrideLabel}
          >
            {OVERRIDE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          {selected.name === "bash" && (
            <>
              <div className="field-label">Command argument (for Bash(prefix:*) rule matching)</div>
              <input
                className="perm-bash-command mono"
                name="bashCommand"
                value={bashCommand}
                onChange={(e) => onBashCommandChange(e.target.value)}
                aria-label="Bash command argument"
              />
            </>
          )}

          <button type="button" className="perm-call-button" onClick={onCallTool}>
            Call {selected.name}()
          </button>
        </div>
      )}
    </div>
  );
}
