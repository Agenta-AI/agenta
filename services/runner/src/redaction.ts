/**
 * Known-value redaction pass, mirrored SDK-side in
 * `sdks/python/agenta/sdk/redaction/redactor.py` (+ env seeding in
 * `sdks/python/agenta/sdk/redaction/seed.py`).
 *
 * Slice 1 (docs/designs/online-redaction): exact-match against a per-run deny-set of known live
 * secrets, wired at every sink (errors, records, spans, logs). Shape/entropy passes (Slice 2)
 * are declared as no-op extension points (`shapePass` / `entropyPass`) so activating them later
 * is a wiring change, not a redesign.
 *
 * Fail-safe: any exception during redaction returns the placeholder, never the raw string.
 */

const PLACEHOLDER_BARE = "[ag:redacted]";

type RedactionMode = "off" | "known" | "pattern" | "full";
const LIVE_MODES: ReadonlySet<string> = new Set(["off", "known"]);
const INERT_MODES: ReadonlySet<string> = new Set(["pattern", "full"]);

let warnedInertMode = false;

/**
 * `AGENTA_REDACTION_MODE`: only `off`/`known` are live in Slice 1; `pattern`/`full` are
 * declared-but-inert and behave as `known` with a one-time warning (mirrors
 * api/oss/src/utils/env.py's `RedactionConfig`).
 */
export function redactionMode(): RedactionMode {
  const raw = (process.env.AGENTA_REDACTION_MODE ?? "known")
    .trim()
    .toLowerCase();
  if (INERT_MODES.has(raw)) {
    if (!warnedInertMode) {
      warnedInertMode = true;
      process.stderr.write(
        `[redaction] AGENTA_REDACTION_MODE=${raw} is declared but inert (Slice 2 not shipped); behaving as 'known'.\n`,
      );
    }
    return "known";
  }
  if (!LIVE_MODES.has(raw)) {
    if (!warnedInertMode) {
      warnedInertMode = true;
      process.stderr.write(
        `[redaction] AGENTA_REDACTION_MODE=${raw} is not recognized; behaving as 'known'.\n`,
      );
    }
    return "known";
  }
  return raw as RedactionMode;
}

function placeholder(kind: string, value: string): string {
  const last4 = value.length >= 4 ? value.slice(-4) : value;
  return `[ag:redacted:${kind}:${last4}]`;
}

/** The raw value plus its common encodings, so a value redacts even when echoed encoded. */
function variants(value: string): string[] {
  const out = [value];
  try {
    out.push(encodeURIComponent(value));
  } catch {
    // ignore
  }
  try {
    out.push(Buffer.from(value, "utf-8").toString("base64"));
  } catch {
    // ignore
  }
  return out;
}

const DSN_USERINFO_RE = /^[a-zA-Z][\w+.-]*:\/\/([^:/@\s]+):([^@/\s]+)@/;
const BASIC_AUTH_RE = /^([^:\s]+):([^:\s]+)$/;

/** Parts of a compound credential worth registering individually: the DSN userinfo
 * (`scheme://user:pass@`) or a bare `user:pass` pair — register both halves. */
function decompose(value: string): string[] {
  const match = DSN_USERINFO_RE.exec(value) ?? BASIC_AUTH_RE.exec(value);
  if (!match) return [];
  return [match[1], match[2]].filter((part): part is string => !!part);
}

const STACK_FRAME_RE = /\bat\s+\S+\s*\(|\bFile\s+"|\/[\w./-]+:\d+/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Values never redacted even if a secret-named env var holds them: booleans/flags/common
// tokens would poison the deny-set (redacting every "true"/"1" in output). Operators extend,
// never shrink (env override unions onto this default).
export const DEFAULT_REDACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  "true",
  "false",
  "none",
  "null",
  "nil",
  "yes",
  "no",
  "on",
  "off",
  "enabled",
  "disabled",
  "0",
  "1",
  "-1",
  "",
]);

// Service/vendor name prefixes: any env var under a matched provider seeds its value. Default
// EMPTY (opt-in via AGENTA_REDACTED_PREFIXES) — a broad prefix over-seeds non-secret config;
// suffix carries the baseline.
export const DEFAULT_REDACTED_PREFIXES: readonly string[] = [];

// A name ending in one of these looks like a secret value.
export const DEFAULT_REDACTED_SUFFIXES: readonly string[] = [
  "_KEY",
  "_SECRET",
  "_TOKEN",
  "_AUTHTOKEN",
  "_PASSWORD",
  "_CREDENTIALS",
  "_KEY_ID",
  "_SECRET_ID",
  "_TOKEN_ID",
];

// Env NAMES to force-seed (equals/contains) — the escape hatch for a real secret whose name
// matches no suffix. AWS_BEARER_TOKEN_BEDROCK is the one such catalog secret.
export const DEFAULT_REDACTED_BLOCKLIST: readonly string[] = [
  "AWS_BEARER_TOKEN_BEDROCK",
];

function csvOverride(name: string): string[] {
  const raw = process.env[name] ?? "";
  return raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);
}

/** Default CONCATENATED with the operator's env entries (merge, never replace) — dedup, keep
 * order (defaults first). */
function merged(defaults: readonly string[], envName: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...defaults, ...csvOverride(envName)]) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function effectivePrefixes(): string[] {
  return merged(DEFAULT_REDACTED_PREFIXES, "AGENTA_REDACTED_PREFIXES");
}

function effectiveSuffixes(): string[] {
  return merged(DEFAULT_REDACTED_SUFFIXES, "AGENTA_REDACTED_SUFFIXES");
}

function effectiveBlocklist(): string[] {
  return merged(DEFAULT_REDACTED_BLOCKLIST, "AGENTA_REDACTED_BLOCKLIST");
}

/** Default allowlist UNION operator additions (merge, never replace). */
export function effectiveAllowlist(): Set<string> {
  const out = new Set(DEFAULT_REDACTION_ALLOWLIST);
  const raw = process.env.AGENTA_REDACTED_ALLOWLIST ?? "";
  for (const item of raw.split(",")) {
    const trimmed = item.trim().toLowerCase();
    if (trimmed) out.add(trimmed);
  }
  return out;
}

function looksSecret(name: string): boolean {
  const upper = name.toUpperCase();
  if (effectivePrefixes().some((prefix) => upper.startsWith(prefix)))
    return true;
  if (effectiveSuffixes().some((suffix) => upper.endsWith(suffix))) return true;
  const blocklist = effectiveBlocklist();
  return (
    blocklist.length > 0 && blocklist.some((entry) => upper.includes(entry))
  );
}

/** The VALUES (never the names) of every process env var whose name is selected by the
 * PREFIX/SUFFIX/BLOCKLIST matchers. Mirrors `seed.py`'s `curated_env_secret_values`. */
export function curatedEnvSecretValues(): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value && looksSecret(name)) values.push(value);
  }
  return values;
}

/** Never log the matched value — only sink/kind counts. */
export const metrics = {
  counts: new Map<string, number>(),
  increment(sink: string, kind: string): void {
    const key = `${sink}:${kind}`;
    metrics.counts.set(key, (metrics.counts.get(key) ?? 0) + 1);
  },
  snapshot(): Record<string, number> {
    return Object.fromEntries(metrics.counts);
  },
  reset(): void {
    metrics.counts.clear();
  },
};

/**
 * Known-value redaction: exact-match against a deny-set of live secrets.
 *
 * `withKnownSecrets` seeds the deny-set; `redactString` / `redactJson` / `redactError` apply
 * it. Zero false positives — a value is only ever redacted if the caller told us it's a live
 * secret.
 */
export class Redactor {
  // Effective allowlist = default UNION operator additions (merge, never replace): a safety
  // guard, so extending it can only spare more, never start redacting booleans.
  private allowlist: Set<string>;
  private known = new Map<string, string>(); // variant -> kind
  // Decomposed compound-credential parts need word-boundary matching so a short part can't
  // clip inside an unrelated word in user content; the full value/encoding variants are
  // high-entropy enough to substring-match safely.
  private bounded = new Set<string>();
  private sortedValues: string[] = []; // longest-first, recomputed on seed

  constructor(options?: { allowlist?: Iterable<string> }) {
    this.allowlist = new Set(DEFAULT_REDACTION_ALLOWLIST);
    for (const item of options?.allowlist ?? []) {
      this.allowlist.add(item.toLowerCase());
    }
  }

  withKnownSecrets(
    values: Array<string | null | undefined>,
    kind = "secret",
  ): this {
    for (const value of values) {
      if (!value || typeof value !== "string") continue;
      if (this.allowlist.has(value.trim().toLowerCase())) continue; // worthless/common value
      for (const variant of variants(value)) {
        if (variant && variant.length >= 4 && !this.known.has(variant)) {
          this.known.set(variant, kind);
        }
      }
      // Decomposed parts are shorter and more collision-prone, so require more length and
      // match only on a word boundary (never mid-token in unrelated content).
      for (const part of decompose(value)) {
        if (part && part.length >= 8) {
          if (!this.known.has(part)) this.known.set(part, kind);
          this.bounded.add(part);
        }
      }
    }
    this.sortedValues = [...this.known.keys()].sort(
      (a, b) => b.length - a.length,
    );
    return this;
  }

  redactString(
    value: string | null | undefined,
    sink = "unknown",
  ): string | null | undefined {
    if (value === null || value === undefined) return value;
    try {
      return this.knownValuePass(value, sink);
    } catch {
      // fail-safe: never leak the raw string on error
      return PLACEHOLDER_BARE;
    }
  }

  private knownValuePass(value: string, sink: string): string {
    if (redactionMode() === "off" || this.sortedValues.length === 0 || !value) {
      return this.shapePass(value, sink);
    }
    let out = value;
    for (const variant of this.sortedValues) {
      const kind = this.known.get(variant)!;
      if (this.bounded.has(variant)) {
        const pattern = new RegExp(
          `(?<!\\w)${escapeRegExp(variant)}(?!\\w)`,
          "g",
        );
        if (pattern.test(out)) {
          pattern.lastIndex = 0;
          out = out.replace(pattern, placeholder(kind, variant));
          metrics.increment(sink, kind);
        }
      } else if (out.includes(variant)) {
        out = out.split(variant).join(placeholder(kind, variant));
        metrics.increment(sink, kind);
      }
    }
    return this.shapePass(out, sink);
  }

  redactJson<T = unknown>(obj: T, sink = "unknown"): T {
    try {
      return this.redactJsonInner(obj, sink);
    } catch {
      // fail-safe: never leak the raw value, but keep the caller's shape
      if (Array.isArray(obj)) return [] as unknown as T;
      if (obj && typeof obj === "object") return {} as unknown as T;
      return PLACEHOLDER_BARE as unknown as T;
    }
  }

  private redactJsonInner<T>(obj: T, sink: string): T {
    if (typeof obj === "string") {
      return this.knownValuePass(obj, sink) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        this.redactJsonInner(item, sink),
      ) as unknown as T;
    }
    if (obj && typeof obj === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        obj as Record<string, unknown>,
      )) {
        out[key] = this.redactJsonInner(value, sink);
      }
      return out as unknown as T;
    }
    return obj;
  }

  /** Strip stack-frame noise, then run the known-value pass on what remains. */
  redactError(error: unknown, sink = "error"): string {
    try {
      const raw = error === null || error === undefined ? "" : String(error);
      let message = raw.split("\n", 1)[0].trim();
      if (!message || STACK_FRAME_RE.test(message)) {
        message = "agent run failed";
      }
      return this.knownValuePass(message, sink);
    } catch {
      return PLACEHOLDER_BARE;
    }
  }

  // --- Slice 2 extension points (shape/entropy passes). No-ops until the §7.1 opt-in ships. ---

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private shapePass(value: string, _sink: string): string {
    /** Credential-shape + token-shape passes (Slice 2). No-op in Slice 1. */
    return value;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private entropyPass(value: string, _sink: string): string {
    /** Entropy pass (Slice 2). No-op in Slice 1. */
    return value;
  }
}

/**
 * Build (or extend) a per-run deny-set from resolved secrets + the run credential + the
 * selected env vars' values. Never seeds by key name; allowlisted values are dropped.
 * Mirrors `seed.py`'s `seed_from_request`.
 */
export function seedFromEnv(options?: {
  resolvedSecrets?: Array<string | null | undefined>;
  runCredential?: string | null;
  extraValues?: Array<string | null | undefined>;
  redactor?: Redactor;
}): Redactor {
  const r =
    options?.redactor ?? new Redactor({ allowlist: effectiveAllowlist() });
  const values: Array<string | null | undefined> = [
    ...(options?.resolvedSecrets ?? []),
    options?.runCredential,
    ...(options?.extraValues ?? []),
    ...curatedEnvSecretValues(),
  ];
  return r.withKnownSecrets(values);
}
