/**
 * Numeric environment config read against an explicit domain.
 *
 * Every ops-tunable number in the runner is a timer delay, a byte budget, or an attempt count —
 * each with a domain the consuming API actually accepts. Hand-rolled `Number(process.env.X ?? d)`
 * reads do not encode that domain, and every way of getting it wrong fails *silently in the
 * direction of "no protection at all"*:
 *
 *  - junk ("30s", "5 min") parses to `NaN`; `setTimeout(fn, NaN)` fires on the next tick, so a
 *    coalescing window or poll cadence collapses into a busy path instead of falling back.
 *  - a sub-millisecond value floors to `0`; `AbortSignal.timeout(0)` aborts the request
 *    immediately, so every call fails and the feature degrades permanently and quietly.
 *  - a value above `TIMER_MAX_MS` overflows Node's 32-bit timer: the delay silently becomes 1 ms
 *    (a "very long timeout" turns into an instant one), and past 2^32-1
 *    `AbortSignal.timeout` throws `ERR_OUT_OF_RANGE` outright.
 *
 * So the domain is stated once, here, and clamped into rather than trusted. A bad override is
 * never fatal — it falls back or clamps and warns once (a hot path must not spam stderr) —
 * because a typo in one env var must not break every run in the process.
 */

/**
 * Node timers (`setTimeout`, `AbortSignal.timeout`) take a delay that fits in a 32-bit signed
 * int. Above this the delay silently clamps to 1 ms; `AbortSignal.timeout` throws past 2^32-1.
 * ~24.8 days — no runner timeout is legitimately longer.
 */
export const TIMER_MAX_MS = 2_147_483_647;

function defaultLog(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/** Names already warned about, so a per-turn or per-poll read warns once, not every call. */
const warnedNames = new Set<string>();

/** Test-only: forget which names have warned, so a case can assert on the warning it triggers. */
export function resetEnvWarnings(): void {
  warnedNames.clear();
}

export interface EnvIntOptions {
  /** Lowest accepted value; anything below is clamped up to it. Defaults to 1 — zero is a
   *  degenerate delay/count everywhere in the runner, never a meaningful "disabled". */
  min?: number;
  /** Highest accepted value; anything above is clamped down to it. */
  max?: number;
  /** Where a bad-override warning goes. Defaults to stderr. */
  log?: (msg: string) => void;
}

/**
 * Read `name` as an integer inside `[min, max]`, falling back to `fallback` (a trusted code
 * constant, used as-is) when unset or unparseable.
 *
 * Unset or empty is the normal case and stays silent; a value that was *set but unusable* is
 * reported once, since it means the operator's intent is not in effect.
 */
export function envInt(
  name: string,
  fallback: number,
  { min = 1, max = Number.MAX_SAFE_INTEGER, log = defaultLog }: EnvIntOptions = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    warnOnce(name, `unparseable value '${raw}'; using ${fallback}`, log);
    return fallback;
  }

  const clamped = clampInt(parsed, min, max);
  if (clamped !== Math.trunc(parsed)) {
    warnOnce(
      name,
      clamped === min
        ? `${raw} below minimum ${min}; clamped`
        : `${raw} above maximum ${max}; clamped`,
      log,
    );
  }
  return clamped;
}

/**
 * Force an already-computed delay into the timer domain.
 *
 * `envInt` guards the read boundary, but a delay is often *derived* afterwards — a fraction of
 * another limit, a backoff, a remaining budget — and arithmetic on two in-domain values can
 * still land outside it (half of the smallest legal delay rounds to 0, which fires instantly).
 * Run any derived delay through this so the domain holds by construction rather than by
 * re-deriving the argument at each site.
 */
export function clampTimerMs(ms: number, { min = 1 }: { min?: number } = {}): number {
  return clampInt(ms, min, TIMER_MAX_MS);
}

/** Truncate before clamping: a fractional value like 0.5 must not floor to a 0 that then
 *  passes a naive `> 0` check. `NaN` is the only input with no magnitude to clamp toward, so
 *  it takes the floor; ±Infinity has a direction and lands on the matching end of the range. */
function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Read `name` as a timer delay in ms. Same as `envInt` with the ceiling Node's timers impose,
 * so an override can shorten or lengthen a timeout but can never turn it into "fires instantly".
 */
export function envTimerMs(
  name: string,
  fallbackMs: number,
  options: EnvIntOptions = {},
): number {
  return envInt(name, fallbackMs, {
    ...options,
    max: Math.min(options.max ?? TIMER_MAX_MS, TIMER_MAX_MS),
  });
}

/**
 * Read `name` as an on/off switch for a diagnostic that is off by default.
 *
 * Deliberately permissive in one direction only: anything set and not an explicit off word turns
 * the diagnostic ON, so `=1` / `=true` / `=yes` all work and a typo cannot silently leave an
 * operator without the output they asked for.
 */
export function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return false;
  return !["0", "false", "no", "off"].includes(raw);
}

function warnOnce(name: string, detail: string, log: (msg: string) => void): void {
  if (warnedNames.has(name)) return;
  warnedNames.add(name);
  log(`[env] ${name}: ${detail}`);
}
