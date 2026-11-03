/** `.agenta/mock.json` (a `harnessFiles` entry): read and validated, never defaulted on error. */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { MOCK_BEHAVIORS } from "./mock-behaviors.ts";

export const MOCK_CONFIG_RELATIVE_PATH = ".agenta/mock.json";

export interface MockConfig {
  behavior: string;
  kwargs: Record<string, unknown>;
}

export function parseMockConfig(raw: string): MockConfig {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `mock harness config at ${MOCK_CONFIG_RELATIVE_PATH} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      `mock harness config at ${MOCK_CONFIG_RELATIVE_PATH} must be a JSON object`,
    );
  }
  const { behavior, kwargs } = data as Record<string, unknown>;
  if (typeof behavior !== "string" || !behavior) {
    throw new Error(
      `mock harness config at ${MOCK_CONFIG_RELATIVE_PATH} is missing a string 'behavior' field`,
    );
  }
  if (!Object.hasOwn(MOCK_BEHAVIORS, behavior)) {
    throw new Error(
      `mock harness config at ${MOCK_CONFIG_RELATIVE_PATH} names unknown behaviour ` +
        `'${behavior}'; known behaviours: ${Object.keys(MOCK_BEHAVIORS).join(", ")}`,
    );
  }
  if (
    kwargs !== undefined &&
    (typeof kwargs !== "object" || kwargs === null || Array.isArray(kwargs))
  ) {
    throw new Error(
      `mock harness config at ${MOCK_CONFIG_RELATIVE_PATH} field 'kwargs' must be an object`,
    );
  }
  return { behavior, kwargs: (kwargs as Record<string, unknown>) ?? {} };
}

/** Read `.agenta/mock.json` from the session cwd: local fs directly, sandbox FS API on Daytona. */
export async function readMockConfig(
  sandbox: { readFsFile: (input: { path: string }) => Promise<string | Uint8Array> },
  cwd: string,
  isDaytona: boolean,
): Promise<MockConfig> {
  const path = isDaytona
    ? posix.join(cwd, MOCK_CONFIG_RELATIVE_PATH)
    : join(cwd, MOCK_CONFIG_RELATIVE_PATH);
  let raw: string;
  if (isDaytona) {
    let bytes: string | Uint8Array;
    try {
      bytes = await sandbox.readFsFile({ path });
    } catch (err) {
      throw new Error(
        `mock harness config not found at ${path}: ${(err as Error).message}`,
      );
    }
    raw = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
  } else {
    if (!existsSync(path)) {
      throw new Error(`mock harness config not found at ${path}`);
    }
    raw = readFileSync(path, "utf-8");
  }
  return parseMockConfig(raw);
}
