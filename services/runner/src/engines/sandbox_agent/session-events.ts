import { harnessKindOf } from "../../harness-kind.ts";
import { conciseError } from "./errors.ts";
import type { SessionEnvironment } from "./runtime-contracts.ts";

/**
 * Route one harness event into the active turn's sink.
 *
 * Data flow: the ACP session emits an event -> we demux it -> the active turn
 * (`environment.currentTurn`) consumes the update. The session listener is attached ONCE and
 * outlives every turn, so this must never throw: the sandbox-agent registries are plain Sets and a
 * thrown handler would corrupt the event stream, so any error is swallowed and logged.
 *
 * Steps: let the ENOTCONN watcher observe the raw event, extract the update payload (dropping events
 * that carry none), then hand the update to the active turn. The turn admits output before
 * indexing tool calls. Between turns, log and drop updates rather than retaining stray calls.
 */
function routeSessionEventToActiveTurn(
  environment: SessionEnvironment,
  remountLocalCwdAfterRuntimeEnotconn: (event: unknown) => void,
  event: any,
): void {
  const { logger, plan } = environment;
  try {
    remountLocalCwdAfterRuntimeEnotconn(event);
    const payload = event?.payload;
    const update = payload?.params?.update ?? payload?.update;
    if (!update) return;
    const turn = environment.currentTurn;
    // Claude's running cost total can land on the SSE stream after the prompt response settled
    // the turn's usage, or after the turn ended. The turn keeps what it reported; the reading
    // only moves the baseline the next turn's share is measured from.
    const costReading = update.cost?.amount;
    if (
      update.sessionUpdate === "usage_update" &&
      typeof costReading === "number" &&
      harnessKindOf(plan.harness) === "claude" &&
      (!turn || turn.usageSettled)
    ) {
      environment.harnessCostReading = costReading;
    }
    if (turn) {
      turn.handleUpdate(update);
    } else {
      // Between turns (parked/idle): no turn owns this event. Log and drop by decision.
      logger(`[keepalive] between-turns event dropped`);
    }
  } catch (err) {
    logger(`session onEvent handler error: ${conciseError(err, plan.harness)}`);
  }
}

/**
 * Route one permission gate into the active turn's approval handler.
 *
 * Data flow: the harness raises a permission request -> the active turn (`environment.currentTurn`)
 * decides it. Like the event listener this is attached ONCE and must never throw (a thrown handler
 * would corrupt the sandbox-agent registries), so errors are swallowed and logged.
 *
 * Between turns no turn owns the gate. An approval park is always recorded DURING the active turn
 * (the gate fires while a prompt runs, routing through currentTurn), and a parked-on-approval
 * session leaves its harness suspended on that gate, so nothing new fires while parked. A gate that
 * reaches here is therefore a genuine stray (e.g. a late teardown artifact): reject it by policy so
 * it cannot hang.
 */
function routePermissionRequestToActiveTurn(
  environment: SessionEnvironment,
  req: any,
): void {
  const { logger, plan } = environment;
  try {
    const turn = environment.currentTurn;
    if (turn?.onPermissionRequest) {
      turn.onPermissionRequest(req);
      return;
    }
    logger(
      `[keepalive] between-turns permission request, cancelling by policy id=${req?.id}`,
    );
    void Promise.resolve(
      environment.session?.respondPermission?.(req?.id, "reject"),
    ).catch(() => {});
  } catch (err) {
    logger(
      `session onPermissionRequest handler error: ${conciseError(err, plan.harness)}`,
    );
  }
}

export { routeSessionEventToActiveTurn, routePermissionRequestToActiveTurn };
