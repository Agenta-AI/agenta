import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { applyCodexAcpUsagePatch } from "../../src/engines/sandbox_agent/codex-acp-patch.ts";

/**
 * `toTokenCount`, `toPromptUsage`, `handleTokenUsageUpdated` and `buildPromptUsage` are verbatim
 * from the pinned bundle (`@agentclientprotocol/codex-acp` 1.1.7, `dist/index.js`). The turn
 * methods keep the bundle's exact anchor lines inside a smaller body, so the patched source can
 * run here.
 */
const BUNDLE = `
function toTokenCount(usage) {
  return {
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens - usage.cachedInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens
  };
}
function toPromptUsage(tokenCount) {
  return {
    totalTokens: tokenCount.totalTokens,
    inputTokens: tokenCount.inputTokens,
    cachedReadTokens: tokenCount.cachedInputTokens,
    outputTokens: tokenCount.outputTokens,
    thoughtTokens: tokenCount.reasoningOutputTokens
  };
}
var Handler = class {
  constructor(connection, sessionState) {
    this.connection = connection;
    this.sessionState = sessionState;
  }
  handleTokenUsageUpdated(params) {
    this.sessionState.lastTokenUsage = toTokenCount(params.tokenUsage.last);
    this.sessionState.totalTokenUsage = toTokenCount(params.tokenUsage.total);
    this.sessionState.modelContextWindow = params.tokenUsage.modelContextWindow;
  }
};
var Agent = class {
  constructor(sessionState) {
    this.state = sessionState;
  }
  getSessionState() {
    return this.state;
  }
  startTurn(params) {
    const sessionState = this.getSessionState(params.sessionId);
    sessionState.currentTurnId = null;
    sessionState.lastTokenUsage = null;
  }
  endTurn(sessionState) {
    return { usage: this.buildPromptUsage(sessionState.lastTokenUsage) };
  }
  cancelledPromptResponse(sessionState) {
    return { usage: this.buildPromptUsage(sessionState.lastTokenUsage) };
  }
  failedPromptResponse(sessionState) {
    return { usage: this.buildPromptUsage(sessionState.lastTokenUsage) };
  }
  buildPromptUsage(lastTokenUsage) {
    if (lastTokenUsage == null) {
      return null;
    }
    return toPromptUsage(lastTokenUsage);
  }
};
`;

const count = (input: number, cached: number, output: number) => ({
  totalTokens: input + output,
  inputTokens: input,
  cachedInputTokens: cached,
  outputTokens: output,
  reasoningOutputTokens: 0,
});

function load(source: string) {
  return new Function(`${source}; return { Handler, Agent };`)() as {
    Handler: new (
      c: unknown,
      s: any,
    ) => {
      handleTokenUsageUpdated(p: unknown): void;
    };
    Agent: new (s: any) => {
      startTurn(p: unknown): void;
      endTurn(s: any): { usage: any };
    };
  };
}

function patched(): string {
  const outcome = applyCodexAcpUsagePatch(BUNDLE);
  assert.equal(outcome.kind, "patched");
  return (outcome as { source: string }).source;
}

function session(source: string, state: any) {
  const { Handler, Agent } = load(source);
  const handler = new Handler(null, state);
  const agent = new Agent(state);
  return {
    turn(updates: Array<{ last: any; total: any }>) {
      agent.startTurn({ sessionId: "s" });
      for (const u of updates)
        handler.handleTokenUsageUpdated({
          tokenUsage: { ...u, modelContextWindow: 400000 },
        });
      return agent.endTurn(state).usage;
    },
  };
}

describe("applyCodexAcpUsagePatch", () => {
  it("stock codex-acp reports only the last model call of a turn", () => {
    const run = session(BUNDLE, {});
    const usage = run.turn([
      { last: count(100, 0, 10), total: count(100, 0, 10) },
      { last: count(200, 150, 20), total: count(300, 150, 30) },
    ]);
    assert.equal(usage.inputTokens, 50);
    assert.equal(usage.outputTokens, 20);
  });

  it("reports every model call of the turn, with cached tokens split out", () => {
    const run = session(patched(), {});
    const first = run.turn([
      { last: count(100, 0, 10), total: count(100, 0, 10) },
      { last: count(200, 150, 20), total: count(300, 150, 30) },
    ]);
    assert.deepEqual(
      [first.inputTokens, first.cachedReadTokens, first.outputTokens],
      [150, 150, 30],
    );
    const second = run.turn([
      { last: count(50, 0, 5), total: count(350, 150, 35) },
    ]);
    assert.deepEqual(
      [second.inputTokens, second.cachedReadTokens, second.outputTokens],
      [50, 0, 5],
    );
  });

  it("does not charge a resumed session's history to its first turn", () => {
    const run = session(patched(), {});
    const usage = run.turn([
      { last: count(40, 10, 4), total: count(90040, 30010, 804) },
    ]);
    assert.deepEqual(
      [usage.inputTokens, usage.cachedReadTokens, usage.outputTokens],
      [30, 10, 4],
    );
  });

  it("reports no usage for a turn with no model call", () => {
    const run = session(patched(), {});
    run.turn([{ last: count(10, 0, 1), total: count(10, 0, 1) }]);
    assert.equal(run.turn([]), null);
  });

  it("is idempotent", () => {
    assert.equal(applyCodexAcpUsagePatch(patched()).kind, "already-patched");
  });

  it("fails closed when an anchor moved", () => {
    const drifted = BUNDLE.replace(
      "sessionState.lastTokenUsage = null;",
      "sessionState.lastTokenUsage = undefined;",
    );
    assert.equal(applyCodexAcpUsagePatch(drifted).kind, "anchor-missing");
  });
});
