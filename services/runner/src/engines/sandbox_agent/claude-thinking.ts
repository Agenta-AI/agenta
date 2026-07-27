/**
 * Make the Claude harness surface its extended-thinking reasoning in the playground.
 *
 * Recent Claude models default extended-thinking `display` to `"omitted"`: the API returns
 * signature-only thinking blocks whose text is empty. `@agentclientprotocol/claude-agent-acp`
 * emits an `agent_thought_chunk` only when that text is non-empty, so on those models the
 * runner never sees any reasoning and the UI shows none — while models that return thinking
 * text (e.g. Haiku) work. Requesting `display: "summarized"` (the documented Anthropic default,
 * which recent models override to `"omitted"`) makes the reasoning text come back for every
 * model, without forcing a fixed budget: `type: "adaptive"` leaves the decision of whether/how
 * much to think to the model. `"summarized"` still returns the thinking signature, so multi-turn
 * thinking continuity is unaffected.
 *
 * Rides `_meta.claudeCode.options`, which `claude-agent-acp` spreads over its env-derived
 * thinking config (so this wins). Same `_meta` channel the system-prompt append uses.
 */
export interface ClaudeThinkingMeta {
  claudeCode: { options: { thinking: { type: "adaptive"; display: "summarized" } } };
}

export function claudeThinkingMeta(): ClaudeThinkingMeta {
  return {
    claudeCode: { options: { thinking: { type: "adaptive", display: "summarized" } } },
  };
}
