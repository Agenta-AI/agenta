import { randomBytes } from "node:crypto";

import { DaytonaNotFoundError } from "@daytonaio/sdk";

import type {
  DaytonaSecretCandidate,
  DaytonaSecretPlan,
} from "./daytona-secret-plan.ts";

export interface DaytonaSecretRecord {
  id: string;
  name: string;
  placeholder: string;
  hosts?: string[];
}

export interface DaytonaSecretApi {
  create(input: {
    name: string;
    value: string;
    description?: string;
    hosts: string[];
  }): Promise<DaytonaSecretRecord>;
  delete(id: string): Promise<void>;
}

export interface DaytonaSecretAllocation {
  attachments: Record<string, string>;
  mcpHeaderPlaceholders: Record<string, Record<string, string>>;
  created: DaytonaSecretRecord[];
}

/**
 * True when a Daytona failure means "the resource is already gone": the SDK's typed
 * not-found error, or any 404-shaped error object. The one absence predicate shared by
 * Secret cleanup here and the sandbox lifecycle wrapper (`daytona-secret-provider.ts`).
 */
export function isDaytonaNotFound(error: unknown): boolean {
  return (
    error instanceof DaytonaNotFoundError ||
    (typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      error.statusCode === 404)
  );
}

/**
 * True when a Daytona failure means "this API key is not allowed to do that".
 *
 * Worth recognizing on its own because it has exactly one cause in practice and a completely
 * different fix from every other failure here. A Daytona API key is minted with a set of
 * permissions, and a key that can create sandboxes does not necessarily have the separate
 * permission to manage Secrets. When it does not, every run with a hideable credential fails at
 * sandbox creation, and the raw provider message says nothing about the flag that caused it.
 */
export function isDaytonaPermissionDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = "statusCode" in error ? error.statusCode : undefined;
  if (status === 401 || status === 403) return true;
  const message = "message" in error ? String(error.message) : "";
  return /\b(403|401)\b|forbidden|not authorized|unauthorized|permission/i.test(
    message,
  );
}

/** The message an operator can act on, instead of a bare provider status code. */
export const DAYTONA_SECRETS_PERMISSION_MESSAGE =
  "Daytona refused to manage Secrets with this API key. " +
  "This runner hides each model and MCP key by storing it as a Daytona Secret, which is the " +
  "default, and that needs an API key allowed to manage Secrets, not only to create " +
  "sandboxes. Grant that permission to the key in AGENTA_RUNNER_DAYTONA_API_KEY. If you " +
  "would rather send credentials to the sandbox as plain environment variables, which lets " +
  "the agent read them, set AGENTA_RUNNER_DAYTONA_OPAQUE_SECRETS=off.";

async function deleteIdempotently(
  api: DaytonaSecretApi,
  id: string,
): Promise<void> {
  try {
    await api.delete(id);
  } catch (error) {
    if (!isDaytonaNotFound(error)) throw error;
  }
}

function assertCreatedSecret(
  secret: DaytonaSecretRecord,
  expectedName: string,
  candidate: DaytonaSecretCandidate,
): DaytonaSecretRecord {
  if (secret.name !== expectedName) {
    throw new Error("Daytona Secret has an unexpected generated name.");
  }
  if (
    !secret.hosts ||
    secret.hosts.length !== 1 ||
    secret.hosts[0] !== candidate.allowedHost
  ) {
    throw new Error("Daytona Secret has an unexpected host restriction.");
  }
  if (
    !secret.id ||
    !secret.placeholder ||
    !secret.placeholder.startsWith("dtn_secret_") ||
    secret.placeholder === candidate.value
  ) {
    throw new Error(
      "Daytona did not return a valid opaque Secret placeholder.",
    );
  }
  return secret;
}

function generatedName(candidate: DaytonaSecretCandidate): string {
  return `agenta_${randomBytes(18).toString("hex")}_${candidate.ordinal}`;
}

/** Allocate every Secret before sandbox create, compensating in reverse order on any failure. */
export async function allocateDaytonaSecrets(
  plan: DaytonaSecretPlan,
  api: DaytonaSecretApi,
  nameFor: (candidate: DaytonaSecretCandidate) => string = generatedName,
): Promise<DaytonaSecretAllocation> {
  const created: DaytonaSecretRecord[] = [];
  const attachments: Record<string, string> = {};
  const mcpHeaderPlaceholders: Record<string, Record<string, string>> = {};
  try {
    for (const candidate of plan.candidates) {
      const name = nameFor(candidate);
      let rawSecret: DaytonaSecretRecord;
      try {
        rawSecret = await api.create({
          name,
          value: candidate.value,
          description: "Agenta process-local sandbox credential",
          hosts: [candidate.allowedHost],
        });
      } catch (error) {
        // Re-raise a permission refusal as an actionable message. Everything else keeps its
        // original error, and either way the catch below compensates for what was created.
        if (isDaytonaPermissionDenied(error)) {
          throw new Error(DAYTONA_SECRETS_PERMISSION_MESSAGE, { cause: error });
        }
        throw error;
      }
      // Track the provider record before validating returned metadata. If the provider returns a
      // malformed placeholder or host list, compensation must still delete the record it made.
      if (rawSecret.id) created.push(rawSecret);
      const secret = assertCreatedSecret(rawSecret, name, candidate);
      if (candidate.consumer.kind === "model") {
        attachments[candidate.binding.name] = secret.name;
      } else {
        attachments[`AGENTA_MCP_SECRET_${candidate.ordinal}`] = secret.name;
        (mcpHeaderPlaceholders[candidate.consumer.server] ??= {})[
          candidate.binding.name
        ] = secret.placeholder;
      }
    }
    return { attachments, mcpHeaderPlaceholders, created };
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    for (const secret of [...created].reverse()) {
      try {
        await deleteIdempotently(api, secret.id);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupFailures],
        "Daytona Secret allocation failed and compensation was incomplete.",
      );
    }
    throw cause;
  }
}

/** Delete one allocation in reverse creation order. Missing provider records are success. */
export async function deleteDaytonaSecrets(
  allocation: DaytonaSecretAllocation,
  api: DaytonaSecretApi,
): Promise<void> {
  const failures: unknown[] = [];
  for (const secret of [...allocation.created].reverse()) {
    try {
      await deleteIdempotently(api, secret.id);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Daytona Secret cleanup was incomplete.",
    );
  }
}
