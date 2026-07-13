/**
 * Unit tests must not depend on the developer's shell. A loaded dev env file exports
 * AGENTA_INSECURE_EGRESS_ALLOWED (disabling the SSRF guard) and DAYTONA_* credentials
 * (making the daytona provider construct instead of throwing), which silently flips the
 * expected outcome of tests that assert the secure/no-credential default.
 *
 * A test that wants either is free to set it back with vi.stubEnv.
 */
import { beforeEach } from "vitest";

const SCRUBBED = [
  "AGENTA_INSECURE_EGRESS_ALLOWED",
  "AGENTA_WEBHOOKS_ALLOW_INSECURE",
  "AGENTA_WEBHOOK_ALLOW_INSECURE",
  "AGENTA_DAYTONA_OPAQUE_SECRETS",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "DAYTONA_TARGET",
  "DAYTONA_SNAPSHOT",
];

for (const name of SCRUBBED) delete process.env[name];

// Re-scrub per test: a prior test may have set one and not restored it.
beforeEach(() => {
  for (const name of SCRUBBED) delete process.env[name];
});
