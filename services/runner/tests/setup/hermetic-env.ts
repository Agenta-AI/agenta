/**
 * Unit tests must not depend on the developer's shell. A loaded dev env file exports
 * AGENTA_INSECURE_EGRESS_ALLOWED (disabling the SSRF guard) and DAYTONA_* credentials
 * (making the daytona provider construct instead of throwing), which silently flips the
 * expected outcome of tests that assert the secure/no-credential default.
 *
 * A test that wants either is free to set it back with vi.stubEnv.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach } from "vitest";

import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

// The permission-enforcing Pi extension bundle is built by `pnpm run build:extension` into
// `dist/`, which CI does NOT run before the unit suite (only dev builds it). Since the runner now
// FAILS CLOSED when that extension cannot install, a local Pi run whose policy could gate a
// built-in tool would throw in CI purely because the bundle file is absent. Point the bundle at a
// tiny stub file so the install succeeds by default and tests exercise the real gating logic, not
// a missing-artifact accident. A test that wants the install to FAIL overrides this env var (and
// restores it). Its contents are irrelevant — nothing loads it in a unit test.
const STUB_EXTENSION_BUNDLE = join(tmpdir(), "agenta-runner-test-extension.js");
writeFileSync(
  STUB_EXTENSION_BUNDLE,
  "// test stub extension bundle\n",
  "utf-8",
);
process.env.SANDBOX_AGENT_EXTENSION_BUNDLE = STUB_EXTENSION_BUNDLE;

const SCRUBBED = [
  "AGENTA_INSECURE_EGRESS_ALLOWED",
  "AGENTA_WEBHOOKS_ALLOW_INSECURE",
  "AGENTA_WEBHOOK_ALLOW_INSECURE",
  // Scrub BOTH the operator-facing runner names and the ambient SDK names the runner bridges
  // into, so a loaded dev env cannot silently flip a test that asserts the no-credential default.
  "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS",
  "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER",
  "AGENTA_RUNNER_DAYTONA_API_KEY",
  "AGENTA_RUNNER_DAYTONA_API_URL",
  "AGENTA_RUNNER_DAYTONA_TARGET",
  "AGENTA_RUNNER_DAYTONA_SNAPSHOT",
  "AGENTA_RUNNER_DAYTONA_IMAGE",
  "AGENTA_RUNNER_DAYTONA_AUTOSTOP_MINUTES",
  "AGENTA_RUNNER_DAYTONA_AUTODELETE_MINUTES",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "DAYTONA_TARGET",
  "DAYTONA_SNAPSHOT",
];

for (const name of SCRUBBED) delete process.env[name];

// Re-scrub per test: a prior test may have set one and not restored it. Also drop the memoized
// runner config so the next `loadRunnerConfig()` re-parses the scrubbed environment.
beforeEach(() => {
  for (const name of SCRUBBED) delete process.env[name];
  // Restore the stub bundle so a prior test's override (to force a failed install) cannot leak.
  process.env.SANDBOX_AGENT_EXTENSION_BUNDLE = STUB_EXTENSION_BUNDLE;
  resetRunnerConfigCache();
});
