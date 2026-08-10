/**
 * Acquire-stage timing.
 *
 * LIFECYCLE MIGRATION, STEP 5. The timing helper used to be a closure inside
 * `prepareEnvironmentSetup`. It moved here because every lifecycle unit emits a stage line, and a
 * unit cannot reach into another module's closure.
 *
 * THE STAGE NAMES ARE A PUBLIC INTERFACE. Dashboards and log queries match on
 * `[timing] stage=<name>`. The split must not rename, drop, or reorder a single one, so the names
 * live in `ACQUIRE_STAGES` below and a seam test asserts that the whole set still fires. Adding a
 * stage is fine. Renaming one is a breaking change to something outside this repository.
 */

/** A log sink. Matches the `deps.log` shape the engine already threads everywhere. */
export type Log = (message: string) => void;

/**
 * Emit one stage line. `fields` is appended verbatim, which is how `sandbox_start` and
 * `create_session` carry their ` mode=...` suffix.
 */
export type TimingLog = (
  stage: string,
  startedAt: number,
  fields?: string,
) => void;

/**
 * Every stage name the acquire path emits, in the order it emits them.
 *
 * `sandbox_start` and `create_session` appear once each although each has two modes; the mode
 * rides the `fields` suffix rather than the stage name, so a dashboard grouping by stage sees one
 * series with a mode dimension.
 */
export const ACQUIRE_STAGES = [
  "sandbox_start",
  "mounts",
  "agent_mount",
  "prepare_workspace",
  "probe_capabilities",
  "create_session",
  "acquire_total",
] as const;

export type AcquireStage = (typeof ACQUIRE_STAGES)[number];

/**
 * Build the stage logger.
 *
 * `sandboxId` and `sessionId` are read through accessors, not captured by value. The sandbox does
 * not exist when the logger is built, and the session id changes during acquire, so a captured
 * value would log `-` for every stage after the first. This is why the helper is a factory rather
 * than a plain function.
 */
export function createTimingLog(
  logger: Log,
  read: {
    sandboxId: () => string | undefined;
    sessionId: () => string | undefined;
  },
): TimingLog {
  return (stage, startedAt, fields = "") => {
    const sandboxId = read.sandboxId() ?? "-";
    const sessionId = read.sessionId() ?? "-";
    logger(
      `[timing] stage=${stage} ms=${Math.round(Date.now() - startedAt)} sandbox=${sandboxId} session=${sessionId}${fields}`,
    );
  };
}
