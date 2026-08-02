import { randomBytes } from "node:crypto";

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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

async function deleteIdempotently(
  api: DaytonaSecretApi,
  id: string,
): Promise<void> {
  try {
    await api.delete(id);
  } catch (error) {
    if (!isNotFound(error)) throw error;
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
      const rawSecret = await api.create({
        name,
        value: candidate.value,
        description: "Agenta process-local sandbox credential",
        hosts: [candidate.allowedHost],
      });
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
