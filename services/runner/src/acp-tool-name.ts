/**
 * The real tool name on an ACP tool frame, when the harness sends one. ACP `title` is display
 * text: claude-agent-acp titles a Write "Preparing file…" until its input streams, so naming a
 * call after the title freezes that placeholder for the call's whole life.
 */
export const acpToolName = (frame: unknown): string | undefined => {
  if (!frame || typeof frame !== "object") return undefined;
  const { name, _meta } = frame as {
    name?: unknown;
    _meta?: { claudeCode?: { toolName?: unknown } };
  };
  if (typeof name === "string" && name) return name;
  const toolName = _meta?.claudeCode?.toolName;
  return typeof toolName === "string" && toolName ? toolName : undefined;
};
