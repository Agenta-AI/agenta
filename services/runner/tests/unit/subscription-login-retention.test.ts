/** Old ChatGPT logins leave the runner's state dir; a login a session holds never does (flag-safety round). */
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  holdSubscriptionHome,
  SUBSCRIPTION_LOGIN_MAX_IDLE_MS,
  sweepSubscriptionHomes,
} from "../../src/engines/sandbox_agent/subscription-login/retention.ts";

function login(root: string, id: string, ageMs: number): string {
  const home = join(root, id);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "auth.json"), "{}");
  const at = new Date(Date.now() - ageMs);
  utimesSync(join(home, "auth.json"), at, at);
  utimesSync(home, at, at);
  return home;
}

describe("subscription login retention", () => {
  it("deletes a login unused for 7 days and keeps a recent one", () => {
    const root = mkdtempSync(join(tmpdir(), "subscriptions-"));
    const old = login(root, "conn-old", SUBSCRIPTION_LOGIN_MAX_IDLE_MS + 60_000);
    const recent = login(root, "conn-recent", 60_000);
    expect(sweepSubscriptionHomes(root)).toEqual([old]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });

  it("never deletes a login a session holds, and counts the release as a use", () => {
    const root = mkdtempSync(join(tmpdir(), "subscriptions-"));
    const home = login(root, "conn-held", SUBSCRIPTION_LOGIN_MAX_IDLE_MS + 60_000);
    const release = holdSubscriptionHome(home);
    const at = new Date(Date.now() - SUBSCRIPTION_LOGIN_MAX_IDLE_MS - 60_000);
    utimesSync(home, at, at);
    expect(sweepSubscriptionHomes(root)).toEqual([]);
    release();
    expect(sweepSubscriptionHomes(root)).toEqual([]);
    expect(sweepSubscriptionHomes(root, { now: Date.now() + SUBSCRIPTION_LOGIN_MAX_IDLE_MS + 1 })).toEqual([home]);
  });

  it("counts Pi's rewrite of auth.json as a use", () => {
    const root = mkdtempSync(join(tmpdir(), "subscriptions-"));
    const home = login(root, "conn-refreshed", SUBSCRIPTION_LOGIN_MAX_IDLE_MS + 60_000);
    writeFileSync(join(home, "auth.json"), '{"refreshed":true}');
    expect(sweepSubscriptionHomes(root)).toEqual([]);
  });

  it("does nothing when there is no state dir", () => {
    expect(sweepSubscriptionHomes(join(tmpdir(), "no-such-state-dir-xyz"))).toEqual([]);
  });
});
