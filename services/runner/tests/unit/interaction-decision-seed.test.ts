/**
 * Seeding approval decisions from durable interaction rows.
 *
 * A client can answer a gate without the answer ever reaching the turn in band — it answered out
 * of band, or its resume died on the way. The row on the interactions plane is then the only
 * record of the human's yes/no, and these tests pin what the runner is allowed to conclude from
 * it. The bias is fail-closed: a row must say it is an answered approval, and must name the tool,
 * the arguments, and a verdict, or it seeds nothing at all.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

let responseBody: unknown = { interactions: [] };
let responseStatus = 200;
let responseRaw: string | undefined;
let failTransition = false;
const requests: Array<{ url: string; body: unknown }> = [];

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  requests.push({
    url: url as string,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  });
  if (failTransition && /\/transition$/.test(String(url)))
    return new Response("nope", { status: 500 });
  if (responseStatus !== 200)
    return new Response("nope", { status: responseStatus });
  if (responseRaw !== undefined)
    return new Response(responseRaw, { status: 200 });
  return new Response(JSON.stringify(responseBody), { status: 200 });
});

const {
  decisionsFromInteractionRows,
  loadDurableDecisions,
  queryInteractions,
  seedDecisionMap,
} = await import("../../src/sessions/interactions.ts");
const { approvedCallKey, ConversationDecisions } =
  await import("../../src/responder.ts");

const args = { integration: "gmail", tool: "CREATE_EMAIL_DRAFT" };

const row = (over: Record<string, unknown> = {}) => ({
  token: "tok-1",
  kind: "user_approval",
  status: "responded",
  data: {
    request: { tool: "run_tool", args },
    resolution: { verdict: "approved" },
  },
  ...over,
});

beforeEach(() => {
  requests.length = 0;
  responseBody = { interactions: [] };
  responseStatus = 200;
  responseRaw = undefined;
  failTransition = false;
});

describe("decisionsFromInteractionRows", () => {
  it("seeds an answered approval under the key the gate will look up", () => {
    const seeded = decisionsFromInteractionRows([row()]);

    assert.equal(seeded.length, 1);
    assert.equal(seeded[0].key, approvedCallKey("run_tool", args));
    assert.deepEqual(seeded[0].decision, {
      decision: "allow",
      interactionToken: "tok-1",
    });
  });

  it("turns a denied verdict into a deny the gate refuses on", () => {
    const seeded = decisionsFromInteractionRows([
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { verdict: "denied" },
        },
      }),
    ]);

    assert.equal(seeded.length, 1);
    assert.equal(seeded[0].decision.decision, "deny");
  });

  it("seeds nothing from a resolved row, whose decision is already spent (R21)", () => {
    assert.deepEqual(
      decisionsFromInteractionRows([row({ status: "resolved" })]),
      [],
    );
  });

  it("seeds nothing from a pending row, which nobody has answered", () => {
    assert.deepEqual(
      decisionsFromInteractionRows([row({ status: "pending" })]),
      [],
    );
  });

  it("seeds nothing from a cancelled row: a swept gate is not an answer", () => {
    assert.deepEqual(
      decisionsFromInteractionRows([row({ status: "cancelled" })]),
      [],
    );
  });

  it("ignores a row of another kind", () => {
    assert.deepEqual(
      decisionsFromInteractionRows([row({ kind: "client_tool" })]),
      [],
    );
  });

  it("ignores malformed rows rather than guessing a call", () => {
    const malformed = [
      row({ token: undefined }),
      row({ data: {} }),
      row({
        data: {
          request: { tool: "run_tool" },
          resolution: { verdict: "approved" },
        },
      }),
      row({
        data: {
          request: { tool: "", args },
          resolution: { verdict: "approved" },
        },
      }),
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { verdict: "maybe" },
        },
      }),
      row({ data: { request: { tool: "run_tool", args } } }),
    ];

    assert.deepEqual(decisionsFromInteractionRows(malformed), []);
  });

  it("reads the contract spelling, resolution.verdict", () => {
    const seeded = decisionsFromInteractionRows([
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { verdict: "denied" },
        },
      }),
    ]);

    assert.equal(seeded[0]?.decision.decision, "deny");
  });

  it("reads the playground spelling, resolution.outcome", () => {
    const seeded = decisionsFromInteractionRows([
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { tool_call_id: "call-1", outcome: "approved" },
        },
      }),
    ]);

    assert.equal(seeded[0]?.decision.decision, "allow");
  });

  it("reads the boolean spelling, resolution.approved", () => {
    const yes = decisionsFromInteractionRows([
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { tool_call_id: "call-1", approved: true },
        },
      }),
    ]);
    const no = decisionsFromInteractionRows([
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { tool_call_id: "call-1", approved: false },
        },
      }),
    ]);

    assert.equal(yes[0]?.decision.decision, "allow");
    assert.equal(no[0]?.decision.decision, "deny");
  });

  it("skips a resolution whose decision is present but not well-formed", () => {
    const malformed = [
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { verdict: "yes" },
        },
      }),
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { outcome: "ok" },
        },
      }),
      // Truthy but not a boolean: never read as approval.
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { approved: "true" },
        },
      }),
      row({
        data: {
          request: { tool: "run_tool", args },
          resolution: { approved: 1 },
        },
      }),
      row({ data: { request: { tool: "run_tool", args }, resolution: {} } }),
    ];

    assert.deepEqual(decisionsFromInteractionRows(malformed), []);
  });

  it("reads a verdict stored beside the data as well as inside it", () => {
    const seeded = decisionsFromInteractionRows([
      row({
        data: { request: { tool: "run_tool", args } },
        resolution: { verdict: "approved" },
      }),
    ]);

    assert.equal(seeded.length, 1);
    assert.equal(seeded[0].decision.decision, "allow");
  });
});

describe("queryInteractions", () => {
  it("scopes the query to the session, in the nested shape the endpoint reads", async () => {
    await queryInteractions("sess-1", () => "ApiKey k");

    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/sessions\/interactions\/query$/);
    // NOT a flat `{ session_id }`: the endpoint reads `body.query`, so a flat field is ignored
    // and every interaction in the PROJECT comes back. Adopting another session's answer would
    // authorize a call this session's user never approved, so this shape is load-bearing.
    assert.deepEqual(requests[0].body, { query: { session_id: "sess-1" } });
  });

  it("accepts a bare array and both wrapper shapes", async () => {
    responseBody = [row()];
    assert.equal((await queryInteractions("s", () => "a")).length, 1);

    responseBody = { interactions: [row(), row()] };
    assert.equal((await queryInteractions("s", () => "a")).length, 2);

    responseBody = { items: [row()] };
    assert.equal((await queryInteractions("s", () => "a")).length, 1);
  });

  it("degrades when the plane answers with something that is not JSON", async () => {
    responseRaw = "<html>gateway</html>";

    assert.deepEqual(await queryInteractions("sess-1", () => "ApiKey k"), []);
  });

  it("degrades to no durable decisions when the plane is unreachable", async () => {
    responseStatus = 500;

    // Never throws: the turn continues exactly as it would have before this read existed.
    assert.deepEqual(await queryInteractions("sess-1", () => "ApiKey k"), []);
  });
});

describe("seedDecisionMap", () => {
  it("lets the gate honor an approved row, and consumes it once", () => {
    const map = new Map<string, unknown[]>();
    const adopted = seedDecisionMap(map, decisionsFromInteractionRows([row()]));
    const decisions = new ConversationDecisions(map);
    const gate = { executor: "relay" as const, toolName: "run_tool", args };

    assert.equal(adopted.length, 1);
    assert.deepEqual(decisions.take(gate), {
      decision: "allow",
      interactionToken: "tok-1",
    });
    // Consumed on first take, so a replay of the same call raises a fresh gate.
    assert.equal(decisions.take(gate), undefined);
  });

  it("lets the gate refuse on a denied row", () => {
    const map = new Map<string, unknown[]>();
    seedDecisionMap(
      map,
      decisionsFromInteractionRows([
        row({
          data: {
            request: { tool: "run_tool", args },
            resolution: { verdict: "denied" },
          },
        }),
      ]),
    );

    const taken = new ConversationDecisions(map).take({
      executor: "relay",
      toolName: "run_tool",
      args,
    });
    assert.deepEqual(taken, { decision: "deny", interactionToken: "tok-1" });
  });

  it("keeps BOTH decisions when two identical calls were each answered", () => {
    // Two identical calls both park, both get answered out of band, and
    // `loadDurableDecisions` claims both rows. The store is a FIFO list per key exactly so two
    // identical calls each resolve, but the seeded path used to `set` a single-element array —
    // so the first call consumed the only decision and the second asked the human again for
    // something they had already answered, with its row already terminal.
    const map = new Map<string, unknown[]>();
    const adopted = seedDecisionMap(
      map,
      decisionsFromInteractionRows([row(), row({ token: "tok-2" })]),
    );
    const gate = { executor: "relay" as const, toolName: "run_tool", args };
    const decisions = new ConversationDecisions(map);

    assert.equal(
      adopted.length,
      2,
      "both claimed rows are reported as adopted",
    );
    assert.deepEqual(decisions.take(gate), {
      decision: "allow",
      interactionToken: "tok-1",
    });
    assert.deepEqual(
      decisions.take(gate),
      { decision: "allow", interactionToken: "tok-2" },
      "the second identical call is answered by the second row, in row order",
    );
    assert.equal(decisions.take(gate), undefined, "and only twice");
  });

  it("keeps the in-band envelope when a row names the same call", () => {
    const key = approvedCallKey("run_tool", args)!;
    const history = new Map<string, unknown[]>([[key, ["deny"]]]);

    const adopted = seedDecisionMap(
      history,
      decisionsFromInteractionRows([row()]),
    );

    // The row said approved; the transcript said deny. History wins and the row is NOT adopted.
    // It is still claimed upstream by `loadDurableDecisions`, which settles every candidate
    // before seeding — correct, because a key the transcript already carries is an answer this
    // turn has, and the in-band path settles that row anyway.
    assert.deepEqual(adopted, []);
    assert.deepEqual(history.get(key), ["deny"]);
  });
});

describe("loadDurableDecisions", () => {
  it("claims a row before returning it, and posts the transition for that token", async () => {
    responseBody = { interactions: [row()] };

    const loaded = await loadDurableDecisions("sess-1", "ApiKey k", () => {});

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].token, "tok-1");
    // The claim is a real transition to `resolved`, carrying the row's own token: that is what
    // makes the decision single-use across turns (R21) rather than merely read.
    const transition = requests.find((r) => /\/transition$/.test(r.url));
    assert.ok(transition, "expected a transition request");
    assert.equal((transition!.body as Record<string, unknown>).token, "tok-1");
    assert.equal(
      (transition!.body as Record<string, unknown>).status,
      "resolved",
    );
  });

  it("drops a decision whose claim failed, and says so", async () => {
    responseBody = { interactions: [row()] };
    // The query succeeds; only the transition is refused.
    failTransition = true;
    const logged: string[] = [];

    const loaded = await loadDurableDecisions("sess-1", "ApiKey k", (m) =>
      logged.push(m),
    );

    // Unclaimed means unusable: the gate re-raises rather than a second execution being
    // authorized by the same human answer on a later turn.
    assert.deepEqual(loaded, []);
    assert.ok(
      logged.some((m) => m.includes("NOT claimed") && m.includes("tok-1")),
      `expected a NOT-claimed log naming the token, got ${JSON.stringify(logged)}`,
    );
  });

  it("does nothing without a session or a credential", async () => {
    assert.deepEqual(
      await loadDurableDecisions(undefined, "ApiKey k", () => {}),
      [],
    );
    assert.deepEqual(
      await loadDurableDecisions("sess-1", undefined, () => {}),
      [],
    );
    assert.equal(requests.length, 0);
  });
});
