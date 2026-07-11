import type { DaytonaSecretApi } from "./daytona-secrets.ts";
import { cleanupDaytonaLease } from "./daytona-secrets.ts";
import type { SecretLeaseControl } from "./secret-lease-control.ts";

export async function runDaytonaSecretJanitorPage(input: {
  control: SecretLeaseControl; api: DaytonaSecretApi; workerId: string; cursor?: string; claimTtlSeconds?: number;
  deleteSandbox: (id: string) => Promise<void>; confirmSandboxAbsent: (id: string) => Promise<boolean>;
}): Promise<string | undefined> {
  const page = await input.control.query({ provider: "daytona", states: ["reserved", "provisioning", "cleanup_pending", "cleaning"], windowing: { next: input.cursor, limit: 100 } });
  const failures: unknown[] = [];
  for (const candidate of page.leases) {
    const claimed = await input.control.claim(candidate.id, { claimOwner: input.workerId, ttlSeconds: input.claimTtlSeconds ?? 60 });
    if (!claimed) continue;
    const lease = { ...candidate, claim: { id: claimed.claimId, generation: claimed.claimGeneration, expiresAt: claimed.claimExpiresAt } };
    try { await cleanupDaytonaLease({ lease, control: input.control, api: input.api, deleteSandbox: input.deleteSandbox, confirmSandboxAbsent: input.confirmSandboxAbsent }); }
    catch (error) {
      failures.push(error);
      try {
        const current = await input.control.get(lease.id);
        if (current) await input.control.mutate(current.id, { expectedVersion: current.version, claim: { id: lease.claim.id, generation: lease.claim.generation }, transition: "recordRetry", errorCode: "provider_unavailable", nextAttemptAt: new Date(Date.now() + 30_000).toISOString() });
      } catch (retryError) { failures.push(retryError); }
    }
  }
  if (failures.length) throw new AggregateError(failures, "One or more Daytona secret leases could not be reconciled.");
  return page.windowing.next;
}

/** Cursor-driven bounded sweeps; each claim carries a generation fencing token. */
export async function runDaytonaSecretJanitorSweep(input: Parameters<typeof runDaytonaSecretJanitorPage>[0] & { maxPages?: number }): Promise<void> {
  let cursor = input.cursor;
  for (let page = 0; page < (input.maxPages ?? 20); page += 1) {
    cursor = await runDaytonaSecretJanitorPage({ ...input, cursor });
    if (!cursor) return;
  }
}


export function startDaytonaSecretJanitor(input: Parameters<typeof runDaytonaSecretJanitorPage>[0] & { intervalMilliseconds?: number; onError?: (error: unknown) => void }): () => void {
  let stopped = false;
  let running = false;
  let cursor = input.cursor;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { cursor = await runDaytonaSecretJanitorPage({ ...input, cursor }); }
    catch (error) { input.onError?.(error); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), input.intervalMilliseconds ?? 60_000);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
