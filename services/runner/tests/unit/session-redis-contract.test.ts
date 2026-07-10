/**
 * Golden-fixture contract test: Redis coordination plane.
 *
 * Asserts that the TypeScript implementation (src/sessions/contract.ts) agrees
 * with the golden fixture (tests/fixtures/sessions/redis_contract.json) on every
 * key name, TTL, displacement payload shape, Lua script, and cap constant.
 *
 * The Python implementation (api/oss/src/dbs/redis/sessions/contract.py) has a
 * parallel pytest (api/oss/tests/pytest/unit/sessions/test_redis_contract.py)
 * that asserts the same fixture. A drift between the two implementations causes
 * one of the two test suites to fail; you cannot silently break the contract.
 *
 * Run: pnpm exec vitest run tests/unit/session-redis-contract.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ALIVE_TTL_SECONDS,
  RUNNING_TTL_SECONDS,
  ATTACHED_TTL_SECONDS,
  OWNER_TTL_SECONDS,
  HEARTBEAT_INTERVAL_SECONDS,
  HEARTBEAT_WRITE_THRESHOLD_SECONDS,
  aliveKey,
  runningKey,
  attachedKey,
  ownerKey,
  displacedChannel,
  DISPLACEMENT_REASON_STOLEN,
  makeDisplacementPayload,
  RELEASE_IF_OWNER_LUA,
  CONCURRENCY_LIMIT,
  SESSION_ID_MAX_LEN,
  validateSessionId,
} from "../../src/sessions/contract.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(here, "../fixtures/sessions/redis_contract.json");

interface RedisContractFixture {
  ttls: {
    alive: number;
    running: number;
    attached: number;
    owner: number;
    heartbeat_interval: number;
    heartbeat_write_threshold: number;
  };
  keys: {
    alive_example: string;
    running_example: string;
    attached_example: string;
    owner_example: string;
    displaced_channel_example: string;
  };
  displacement_payload: {
    reason: string;
    by: string;
  };
  release_if_owner_lua: string;
  concurrency_limit: number;
  session_id_max_len: number;
  session_id_pattern: string;
}

const fixture = JSON.parse(
  readFileSync(FIXTURE_PATH, "utf-8"),
) as RedisContractFixture;

const SESSION_EXAMPLE = "sess-123";
const WATCHER_EXAMPLE = "watcher-abc";

describe("session Redis contract: TTLs", () => {
  it("alive TTL matches golden", () => {
    assert.equal(ALIVE_TTL_SECONDS, fixture.ttls.alive);
  });
  it("running TTL matches golden", () => {
    assert.equal(RUNNING_TTL_SECONDS, fixture.ttls.running);
  });
  it("attached TTL matches golden", () => {
    assert.equal(ATTACHED_TTL_SECONDS, fixture.ttls.attached);
  });
  it("owner TTL matches golden", () => {
    assert.equal(OWNER_TTL_SECONDS, fixture.ttls.owner);
  });
  it("heartbeat interval matches golden", () => {
    assert.equal(HEARTBEAT_INTERVAL_SECONDS, fixture.ttls.heartbeat_interval);
  });
  it("heartbeat write threshold matches golden", () => {
    assert.equal(
      HEARTBEAT_WRITE_THRESHOLD_SECONDS,
      fixture.ttls.heartbeat_write_threshold,
    );
  });
});

describe("session Redis contract: key builders", () => {
  it("aliveKey matches golden", () => {
    assert.equal(aliveKey(SESSION_EXAMPLE), fixture.keys.alive_example);
  });
  it("runningKey matches golden", () => {
    assert.equal(runningKey(SESSION_EXAMPLE), fixture.keys.running_example);
  });
  it("attachedKey matches golden", () => {
    assert.equal(attachedKey(SESSION_EXAMPLE), fixture.keys.attached_example);
  });
  it("ownerKey matches golden", () => {
    assert.equal(ownerKey(SESSION_EXAMPLE), fixture.keys.owner_example);
  });
  it("displacedChannel matches golden", () => {
    assert.equal(
      displacedChannel(SESSION_EXAMPLE),
      fixture.keys.displaced_channel_example,
    );
  });
});

describe("session Redis contract: displacement payload", () => {
  it("reason constant matches golden", () => {
    assert.equal(
      DISPLACEMENT_REASON_STOLEN,
      fixture.displacement_payload.reason,
    );
  });
  it("makeDisplacementPayload matches golden shape", () => {
    const payload = makeDisplacementPayload(WATCHER_EXAMPLE);
    assert.equal(payload.reason, fixture.displacement_payload.reason);
    assert.equal(payload.by, WATCHER_EXAMPLE);
  });
});

describe("session Redis contract: Lua script", () => {
  it("RELEASE_IF_OWNER_LUA matches golden exactly", () => {
    assert.equal(RELEASE_IF_OWNER_LUA, fixture.release_if_owner_lua);
  });
});

describe("session Redis contract: limits and validation", () => {
  it("concurrency limit matches golden", () => {
    assert.equal(CONCURRENCY_LIMIT, fixture.concurrency_limit);
  });
  it("session id max length matches golden", () => {
    assert.equal(SESSION_ID_MAX_LEN, fixture.session_id_max_len);
  });
  it("validateSessionId accepts valid ids", () => {
    assert.ok(validateSessionId("sess-123"));
    assert.ok(validateSessionId("abc_DEF-123"));
    assert.ok(validateSessionId("a"));
  });
  it("validateSessionId rejects invalid ids", () => {
    assert.ok(!validateSessionId(""));
    assert.ok(!validateSessionId("a".repeat(129)));
    assert.ok(!validateSessionId("path/injection"));
    assert.ok(!validateSessionId("has space"));
    assert.ok(!validateSessionId("has@symbol"));
  });
});
