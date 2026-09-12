/**
 * The structured log vocabulary for hosted subscription logins.
 *
 * New Relic sees this runner through its logs, so every decision on the subscription path emits
 * ONE line with a stable event name and key=value fields. The same fields are set on the active
 * span when there is one, so a run's trace carries the decision too.
 *
 * ONLY ALLOWLISTED SCALARS. The value type is `string | number | boolean | undefined`, which is
 * what keeps a login, a user code, or a provider error body out of both sinks: an object cannot be
 * passed at all, and every call site names its fields explicitly.
 */
import { trace } from "@opentelemetry/api";

export type SubscriptionEvent =
  /** A login was written into a run's agent dir, or deliberately not written. */
  | "subscription.materialize"
  /** One reconciliation pass decided to publish, refused to, or was answered by the API. */
  | "subscription.publish"
  /** The recovery path judged an authentication failure. */
  | "subscription.recovery"
  /** A device-code login attempt changed state. */
  | "subscription.attempt";

export type SubscriptionField = string | number | boolean | undefined;

/** The attribute prefix these fields take on a span. */
const SPAN_ATTRIBUTE_PREFIX = "agenta.subscription.";

/** Bare in the log line when it needs no quoting; JSON otherwise. */
function fieldText(value: string): string {
  return /^[A-Za-z0-9._:@/+-]+$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Emit one event to the run log, and to the active span when the caller runs inside one.
 *
 * Fields whose value is undefined are dropped rather than printed as "undefined", so a line
 * carries only what was actually decided.
 */
export function observeSubscription(
  log: (message: string) => void,
  event: SubscriptionEvent,
  fields: Record<string, SubscriptionField>,
): void {
  const parts = [`event=${event}`];
  const attributes: Record<string, string | number | boolean> = {
    [`${SPAN_ATTRIBUTE_PREFIX}event`]: event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${typeof value === "string" ? fieldText(value) : value}`);
    attributes[`${SPAN_ATTRIBUTE_PREFIX}${key}`] = value;
  }
  log(parts.join(" "));
  try {
    trace.getActiveSpan()?.setAttributes(attributes);
  } catch {
    // Observability must never fail a run.
  }
}

/**
 * A thrown value as the two fields worth recording: the class and the first stack frame.
 *
 * Never the message. A message can quote a request, and a request on this path carries the
 * credential. The frame is a runner path, which names no account.
 */
export function thrownFields(err: unknown): {
  error: string;
  at: string | undefined;
} {
  if (!(err instanceof Error)) return { error: "unknown", at: undefined };
  const frame = (err.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at "));
  return { error: err.name, at: frame };
}
