/**
 * Delete every Daytona sandbox of one session, found by label.
 *
 * `/kill` first drains this pod's own pool entry and in-flight sandboxes. That reaches only what
 * this pod holds. The labels (`sandbox-labels.ts`) reach the rest: a sandbox another pod created,
 * a parked one no pod holds, and an in-process command sandbox. They answer both "which sandboxes
 * belong to this session" and "may this request delete them", so no id is read from a turn row
 * that a project caller can write.
 *
 * KILL IS THE ONE PLACE A POD DELETES A SANDBOX IT DID NOT CREATE. Everywhere else a pod uses,
 * stops and deletes only its own (`created-sandboxes.ts`). Kill may do it because the api has
 * already ended the session's turns, so no other pod can start a turn on these sandboxes. A pod
 * that still holds one in a pool learns of the delete from its sandbox-gone check, or from its own
 * timer: the pool teardown deletes idempotently, and the in-process command sandbox treats a
 * sandbox the provider no longer knows as lost and creates a new one.
 */
import type { Daytona } from "@daytonaio/sdk";

import {
  applyDaytonaSdkEnv,
  buildDaytonaClient,
  deleteDaytonaSandbox,
} from "./daytona-provider.ts";
import {
  daytonaWithProcessLocalSecrets,
  holdsProcessLocalSecretAllocation,
} from "./daytona-secret-provider.ts";
import {
  CONVERSATION_LABEL,
  PROJECT_LABEL,
  sessionSandboxLabels,
} from "./sandbox-labels.ts";
import { loadRunnerConfig } from "../../config/runner-config.ts";

export interface LabelledSandbox {
  /** The raw Daytona id. */
  id: string;
  labels?: Readonly<Record<string, string>>;
  /** Daytona's state as listed. */
  state?: string;
}

/** States in which a delete is already done or under way, so a second one only reports noise. */
const GOING_AWAY = new Set(["destroying", "destroyed"]);

/**
 * How long the label sweep may run inside `/kill`. The api waits 10 s for `/kill`
 * (`_KILL_TIMEOUT_SECONDS`) and the drain before the sweep is bounded at 5 s, so 4 s keeps the
 * two inside that wait with a second to spare. After the deadline the sweep reads no further list
 * page and starts no new delete; deletes already started finish in the background.
 */
export const KILL_SWEEP_DEADLINE_MS = 4_000;

export interface KillSandboxDependencies {
  /** The sandboxes carrying all of `labels`, across every page. */
  list(labels: Record<string, string>): AsyncIterable<LabelledSandbox>;
  /** Delete the sandbox. Not-found is success. This pod holds no Secrets for it. */
  deletePlain(sandboxId: string): Promise<void>;
  /** Whether this process holds the Secret allocation of the sandbox. */
  holdsSecrets(sandboxId: string): boolean;
  /** Delete the sandbox, then its Secrets. Not-found is success. */
  deleteWithSecrets(sandboxId: string): Promise<void>;
  log(message: string): void;
}

/** The part of the Daytona client that kill uses; a test hands in a fake. */
export type DaytonaKillClient = Pick<Daytona, "get" | "list" | "secret">;

export interface KillSandboxesResult {
  listed: number;
  deleted: number;
  failed: number;
}

/**
 * Delete each sandbox labelled with this project and session. A failed delete is logged and does
 * not stop the others: Daytona's autostop and autodelete remove what this leaves behind.
 *
 * Once `signal` aborts, the sweep reads no further list item and starts no delete; it rejects with
 * the abort reason. A delete already started is not cancelled. A late sweep must not start deletes:
 * after `/kill` answers, a new turn of the same session may create a sandbox with the same labels.
 */
export async function deleteLabelledSandboxes(
  scope: { projectId: string; sessionId: string },
  dependencies: KillSandboxDependencies,
  signal?: AbortSignal,
): Promise<KillSandboxesResult> {
  const projectId = scope.projectId.trim();
  const sessionId = scope.sessionId.trim();
  // The label pair is the whole authorization for a delete. With one id missing, the list would
  // run on a single label, or on none and page through every sandbox of the account.
  if (!projectId || !sessionId) {
    dependencies.log("kill: label sweep refused, the scope is missing a project or a session");
    return { listed: 0, deleted: 0, failed: 0 };
  }
  const labels = sessionSandboxLabels(projectId, sessionId);
  const found: string[] = [];
  // The Daytona list takes no signal. Checking after each item stops the loop before it asks for
  // the next page; leaving the loop closes the iterator.
  for await (const sandbox of dependencies.list(labels)) {
    signal?.throwIfAborted();
    // The list filter is the provider's. Check the labels here too, because the label pair is the
    // whole authorization for a delete.
    if (
      sandbox.labels?.[PROJECT_LABEL] !== projectId ||
      sandbox.labels?.[CONVERSATION_LABEL] !== sessionId
    ) {
      continue;
    }
    if (GOING_AWAY.has(String(sandbox.state ?? "").toLowerCase())) continue;
    found.push(sandbox.id);
  }
  signal?.throwIfAborted();
  const outcomes = await Promise.all(
    found.map(async (sandboxId) => {
      try {
        if (dependencies.holdsSecrets(sandboxId)) {
          await dependencies.deleteWithSecrets(sandboxId);
        } else {
          await dependencies.deletePlain(sandboxId);
        }
        return true;
      } catch (error) {
        dependencies.log(
          `kill: delete failed sandbox=${sandboxId}: ${String(
            error instanceof Error ? error.message : error,
          ).slice(0, 200)}`,
        );
        return false;
      }
    }),
  );
  const deleted = outcomes.filter(Boolean).length;
  return { listed: found.length, deleted, failed: found.length - deleted };
}

/**
 * The Daytona calls behind `deleteLabelledSandboxes`, or undefined when this runner has no
 * Daytona: there is nothing to list. A runner with only `local` and `inprocess` still has the
 * Daytona key, and its command sandboxes carry the labels, so `inprocess` counts as Daytona here.
 */
export function daytonaKillDependencies(
  config = loadRunnerConfig(),
  log: (message: string) => void = (message) =>
    process.stderr.write(`[daytona] ${message}\n`),
  buildClient: () => DaytonaKillClient = () => buildDaytonaClient(config.daytona),
): KillSandboxDependencies | undefined {
  const { enabled } = config.providers;
  if (!enabled.includes("daytona") && !enabled.includes("inprocess")) {
    return undefined;
  }
  applyDaytonaSdkEnv(config.daytona);
  const client = buildClient();
  const deletePlain = (sandboxId: string): Promise<void> =>
    deleteDaytonaSandbox(client, sandboxId);
  // The Secrets wrapper owns the order "sandbox gone, then Secrets released" and the retry of a
  // failed cleanup. Over a bare delete, it reaches that cleanup for an id in the process registry.
  const withSecrets = daytonaWithProcessLocalSecrets(
    () => ({
      name: "daytona",
      create: () => Promise.reject(new Error("kill never creates a sandbox")),
      destroy: deletePlain,
    }),
    { candidates: [], environment: {} },
    client.secret,
    {
      createFingerprint: "",
      cleanupDelayMilliseconds:
        config.daytona.autodeleteMinutes * 60_000 + 5_000,
      log,
    },
  );
  return {
    list: (labels) => client.list({ labels }),
    deletePlain,
    holdsSecrets: holdsProcessLocalSecretAllocation,
    deleteWithSecrets: (sandboxId) => withSecrets.destroy(sandboxId),
    log,
  };
}

/** What `/kill` runs after the drain. Never throws: the route stays best-effort. */
export type KillSessionSandboxes = (scope: {
  projectId: string;
  sessionId: string;
}) => Promise<void>;

/**
 * Run the label sweep for one session and wait for it at most `deadlineMs`. At the deadline the
 * route moves on and the sweep stops: it reads no further list page and starts no new delete. A
 * delete already started still finishes in the background, and what the sweep misses is left to
 * Daytona's autostop and autodelete.
 */
export async function sweepSessionSandboxes(
  scope: { projectId: string; sessionId: string },
  dependencies: KillSandboxDependencies | undefined,
  deadlineMs: number = KILL_SWEEP_DEADLINE_MS,
): Promise<void> {
  if (!dependencies) return;
  const { log } = dependencies;
  // Node unrefs this timer, so a pending deadline never holds the process open.
  const deadline = AbortSignal.timeout(deadlineMs);
  const timedOut = new Promise<"timeout">((resolve) =>
    deadline.addEventListener("abort", () => resolve("timeout"), { once: true }),
  );
  const sweep = deleteLabelledSandboxes(scope, dependencies, deadline);
  // The sweep rejects with the abort reason after the deadline, which the race no longer awaits.
  sweep.catch(() => {});
  try {
    const outcome = await Promise.race([sweep, timedOut]);
    if (outcome === "timeout") {
      log(
        `kill: label sweep exceeded ${deadlineMs} ms session=${scope.sessionId}; it starts no further delete, started deletes finish in the background, Daytona removes the rest`,
      );
      return;
    }
    log(
      `kill: session=${scope.sessionId} listed=${outcome.listed} deleted=${outcome.deleted} failed=${outcome.failed}`,
    );
  } catch (error) {
    log(
      `kill: label inventory failed session=${scope.sessionId}: ${String(
        error instanceof Error ? error.message : error,
      ).slice(0, 200)}`,
    );
  }
}

export const killSessionSandboxesByLabel: KillSessionSandboxes = async (
  scope,
) => {
  try {
    await sweepSessionSandboxes(scope, daytonaKillDependencies());
  } catch (error) {
    // Building the Daytona client failed.
    process.stderr.write(
      `[daytona] kill: label inventory failed session=${scope.sessionId}: ${String(
        error instanceof Error ? error.message : error,
      ).slice(0, 200)}\n`,
    );
  }
};
