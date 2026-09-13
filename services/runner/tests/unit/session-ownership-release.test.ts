/**
 * The shutdown release of `owner:session:<id>` affinity claims.
 *
 * `claim_owner` on the API side never steals from a live owner, and nothing released the key,
 * so a runner that exited while holding claims locked each of those sessions out of its own
 * replacement for the rest of the 120-second lease. On the local sandbox provider that is a
 * two-minute outage after every restart: the new replica refuses with "is not the owner of
 * session ... Refusing to cold-start on the wrong host".
 *
 * These tests pin the two halves of the fix: the runner learns which sessions it owns from the
 * beats it already sends, and the shutdown handler hands each one back with an inverse beat.
 *
 * Run: pnpm exec vitest run tests/unit/session-ownership-release.test.ts
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";

const fetchCalls: Array<{
  url: string;
  body: any;
  headers?: RequestInit["headers"];
}> = [];
let fetchImpl: (
  url: string,
  init?: RequestInit,
) => Promise<Response> = async () =>
  new Response(JSON.stringify({}), { status: 200 });

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  fetchCalls.push({ url, body, headers: init?.headers });
  return fetchImpl(url, init);
});

const {
  claimSessionOwnership,
  forgetOwnedSession,
  ownedSessionCount,
  recordOwnedSession,
  releaseOwnedSessions,
  releaseSessionOwnership,
  REPLICA_ID,
} = await import("../../src/sessions/alive.ts");
const { OWNER_TTL_SECONDS } = await import("../../src/sessions/contract.ts");

/** The API answers a claim beat with the winning replica. */
const ownedBy = (replica: string) => async () =>
  new Response(JSON.stringify({ replica_id: replica }), { status: 200 });

beforeEach(() => {
  fetchCalls.length = 0;
  fetchImpl = ownedBy(REPLICA_ID);
  process.env.AGENTA_RUNNER_TOKEN = "runner-secret";
});

afterEach(async () => {
  // The registry is module state; drop whatever a test left in it.
  for (const id of ["sess-1", "sess-2", "sess-other", "sess-fail"]) {
    forgetOwnedSession(id);
  }
  vi.restoreAllMocks();
  delete process.env.AGENTA_RUNNER_TOKEN;
});

describe("learning which sessions this replica owns", () => {
  it("records a session whose claim this replica won", async () => {
    await claimSessionOwnership("sess-1", "Bearer tok-1");
    assert.equal(ownedSessionCount(), 1);
  });

  it("records nothing when another replica owns the session", async () => {
    fetchImpl = ownedBy("other-replica");
    await claimSessionOwnership("sess-other", "Bearer tok-1");
    assert.equal(
      ownedSessionCount(),
      0,
      "a lost claim must never be released later",
    );
  });

  it("records nothing when the claim call itself fails", async () => {
    fetchImpl = async () => new Response("nope", { status: 503 });
    await claimSessionOwnership("sess-1", "Bearer tok-1");
    assert.equal(ownedSessionCount(), 0);
  });

  it("forgets a claim older than the affinity lease", async () => {
    // Every beat records, so a long-lived runner would otherwise hold one entry (and one
    // credential) per session it ever served. A claim older than the lease cannot still be held.
    const t0 = 1_000_000;
    recordOwnedSession("sess-1", "Bearer tok-1", t0);
    assert.equal(ownedSessionCount(t0), 1);

    const expired = t0 + OWNER_TTL_SECONDS * 1000 + 1;
    assert.equal(ownedSessionCount(expired), 0);
  });

  it("keeps a claim a later beat refreshed", async () => {
    const t0 = 1_000_000;
    recordOwnedSession("sess-1", "Bearer tok-1", t0);
    const later = t0 + OWNER_TTL_SECONDS * 1000 - 1;
    recordOwnedSession("sess-1", "Bearer tok-2", later);

    assert.equal(
      ownedSessionCount(later + 10),
      1,
      "a refreshed claim must not expire on its FIRST beat's age",
    );
  });
});

describe("the shutdown release", () => {
  it("sends one inverse beat per owned session", async () => {
    await claimSessionOwnership("sess-1", "Bearer tok-1");
    await claimSessionOwnership("sess-2", "Bearer tok-2");
    fetchCalls.length = 0;

    await releaseOwnedSessions(1_000);

    assert.equal(fetchCalls.length, 2);
    const sessions = fetchCalls.map((c) => c.body.session_id).sort();
    assert.deepEqual(sessions, ["sess-1", "sess-2"]);
    for (const call of fetchCalls) {
      assert.ok(call.url.endsWith("/sessions/streams/heartbeat"));
      assert.equal(call.body.release_owner, true);
      assert.equal(call.body.replica_id, REPLICA_ID);
      assert.equal(
        (call.headers as Record<string, string>)["x-agenta-runner-token"],
        "runner-secret",
      );
      assert.equal(
        call.body.turn_id,
        undefined,
        "a departing runner asserts no turn",
      );
      assert.equal(
        call.body.is_running,
        undefined,
        "a departing runner asserts no liveness",
      );
    }
  });

  it("forgets a released session, so a repeated shutdown sends nothing", async () => {
    await claimSessionOwnership("sess-1", "Bearer tok-1");
    await releaseOwnedSessions(1_000);
    assert.equal(ownedSessionCount(), 0);

    fetchCalls.length = 0;
    await releaseOwnedSessions(1_000);
    assert.deepEqual(fetchCalls, []);
  });

  it("sends nothing at all when this replica owns nothing", async () => {
    await releaseOwnedSessions(1_000);
    assert.deepEqual(fetchCalls, []);
  });

  it("never throws when the API refuses the release", async () => {
    await claimSessionOwnership("sess-fail", "Bearer tok-1");
    fetchImpl = async () => new Response("boom", { status: 500 });

    await releaseOwnedSessions(1_000);

    // Kept, not dropped: the release did not happen, and the 120-second lease is the fallback.
    assert.equal(ownedSessionCount(), 1);
  });

  it("never throws when the API is unreachable", async () => {
    await claimSessionOwnership("sess-fail", "Bearer tok-1");
    fetchImpl = async () => {
      throw new Error("connect ECONNREFUSED");
    };

    await releaseOwnedSessions(1_000);
    assert.equal(ownedSessionCount(), 1);
  });

  it("returns once the deadline passes even if a release never answers", async () => {
    await claimSessionOwnership("sess-1", "Bearer tok-1");
    fetchImpl = () => new Promise<Response>(() => {});

    const started = Date.now();
    await releaseOwnedSessions(50);

    assert.ok(
      Date.now() - started < 2_000,
      "the shutdown release must never hold the process open",
    );
  });
});

describe("releaseSessionOwnership on its own", () => {
  it("reports success only when the API accepts the release", async () => {
    assert.equal(await releaseSessionOwnership("sess-1", "Bearer t"), true);

    fetchImpl = async () => new Response("no", { status: 404 });
    assert.equal(await releaseSessionOwnership("sess-1", "Bearer t"), false);
  });
});
