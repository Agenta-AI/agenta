/**
 * Process-local admission barrier for durable continuation commands.
 *
 * The API may deliver one committed command more than once. Every delivery carries the same
 * `controlCommandId`; only its leader may cross the boundary into execution registration. A
 * concurrent duplicate waits for that leader to finish the durable outcome callback, then
 * acknowledges the same admission without starting an engine run.
 *
 * This is deliberately an admission cache, not the durable source of truth. The API command row is
 * durable. A leader that cannot report admission releases its cache entry, so a later delivery may
 * retry. Once the API accepts the `started` outcome, duplicates remain no-ops for the cache TTL.
 */

const ADMISSION_TTL_MS = 30 * 60 * 1000;

interface PendingAdmission {
  phase: "pending";
  executionId: string;
  insertedAt: number;
  settled: Promise<boolean>;
  settle: (admitted: boolean) => void;
}

interface AppliedAdmission {
  phase: "applied";
  executionId: string;
  insertedAt: number;
}

type Admission = PendingAdmission | AppliedAdmission;

export type ContinuationAdmissionLeader = {
  role: "leader";
  executionId: string;
  admit: () => void;
  release: () => void;
};

export type ContinuationAdmissionClaim =
  | ContinuationAdmissionLeader
  | {
      role: "duplicate";
      /** The first delivery's execution id is authoritative for duplicate outcome reports. */
      executionId: string;
      /** False means the leader failed before durable admission and this delivery may be retried. */
      admitted: Promise<boolean>;
      /** Replace a stale applied cache entry after the API grants a recoverable generation. */
      promote: () => ContinuationAdmissionLeader | undefined;
      /** Evict only the cache generation this duplicate observed. */
      forget: () => void;
    };

const admissions = new Map<string, Admission>();

function createLeader(
  commandId: string,
  executionId: string,
  now: number,
): ContinuationAdmissionLeader {
  let settle!: (admitted: boolean) => void;
  const settled = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const pending: PendingAdmission = {
    phase: "pending",
    executionId,
    insertedAt: now,
    settled,
    settle,
  };
  admissions.set(commandId, pending);

  return {
    role: "leader",
    executionId,
    admit: () => {
      if (admissions.get(commandId) !== pending) return;
      admissions.set(commandId, {
        phase: "applied",
        executionId,
        insertedAt: now,
      });
      pending.settle(true);
    },
    release: () => {
      if (admissions.get(commandId) !== pending) return;
      admissions.delete(commandId);
      pending.settle(false);
    },
  };
}

/** Claim a command immediately before creating/registering its fresh execution guard. */
export function claimContinuationAdmission(
  commandId: string,
  executionId: string,
  now = Date.now(),
): ContinuationAdmissionClaim {
  prune(now);
  const existing = admissions.get(commandId);
  if (existing) {
    return {
      role: "duplicate",
      executionId: existing.executionId,
      admitted:
        existing.phase === "applied" ? Promise.resolve(true) : existing.settled,
      promote: () => {
        const current = admissions.get(commandId);
        if (current && current !== existing) return undefined;
        // A losing concurrent probe may evict the stale generation before this API-winning
        // response returns. The durable API CAS is authoritative: its sole winner may recreate
        // the local barrier when the old cache entry is still present or gone. It must never
        // overwrite a newer pending generation: doing that strands every duplicate awaiting
        // the newer generation's promise.
        return createLeader(commandId, executionId, Date.now());
      },
      forget: () => {
        if (admissions.get(commandId) === existing)
          admissions.delete(commandId);
      },
    };
  }
  return createLeader(commandId, executionId, now);
}

function prune(now: number): void {
  for (const [commandId, admission] of admissions) {
    if (now - admission.insertedAt >= ADMISSION_TTL_MS) {
      admissions.delete(commandId);
      if (admission.phase === "pending") admission.settle(false);
    }
  }
}

/** Test seam: admission state belongs to the process and must not leak between cases. */
export function resetContinuationAdmissionsForTest(): void {
  for (const admission of admissions.values()) {
    if (admission.phase === "pending") admission.settle(false);
  }
  admissions.clear();
}
