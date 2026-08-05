/**
 * Runner identity, surfaced on `GET /health` so a client can detect an incompatible runner
 * before the first run (the version-skew guard).
 *
 * `PROTOCOL_VERSION` is the MAJOR of the `/run` wire contract in `protocol.ts`. Bump it only
 * for a change that is not backward compatible; a client that probes `/health` can then
 * refuse a runner whose protocol major it does not support. `RUNNER_VERSION` is the package
 * version (the build), distinct from the protocol.
 */
import pkg from "../package.json";

export const PROTOCOL_VERSION = 1;
export const RUNNER_VERSION: string = pkg.version;
export const ENGINES = ["sandbox-agent"] as const;
export const HARNESS_KINDS = ["pi_core", "claude", "pi_agenta"] as const;

export interface RunnerInfo {
  status: "ok";
  /** Package build version (e.g. "0.1.0"). */
  runner: string;
  /** Wire-contract major. A client refuses a major it does not understand. */
  protocol: number;
  engines: readonly string[];
  harnesses: readonly string[];
}

export function runnerInfo(): RunnerInfo {
  return {
    status: "ok",
    runner: RUNNER_VERSION,
    protocol: PROTOCOL_VERSION,
    engines: ENGINES,
    harnesses: HARNESS_KINDS,
  };
}
