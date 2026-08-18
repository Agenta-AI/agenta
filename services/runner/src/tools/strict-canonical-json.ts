/**
 * The EXACT canonical serializer for authorization digests (slice S3b).
 *
 * Contract: docs/design/agent-config-editing/contracts/execution-authorization.md 2.3.
 *
 * The runner keeps TWO serializers with two jobs, and this must stay stated in both places
 * or a later reader will "simplify" them back into one:
 *
 * | Serializer                        | Job                              | Behavior                        |
 * |-----------------------------------|----------------------------------|---------------------------------|
 * | `canonicalJson` (responder.ts)    | Approval-key matching on replay  | Lenient. Parses JSON-ish strings.|
 * | `strictCanonicalJson` (this file) | Authorization digests            | Exact. Never parses a string.    |
 *
 * The lenient one is CORRECT for its own job: a model copying object-valued arguments out of
 * a flattened replay transcript writes them back as a JSON string, and the stored approval
 * and the re-issued gate must still meet at one key. Lenient matching is right for matching.
 *
 * It is wrong here. `normalizeJsonish` parses any string that looks like a JSON container,
 * so `{"value": "{\"x\":1}"}` and `{"value": {"x": 1}}` digest identically — and an ordered
 * operation's `value`, a skill body, and a file's content are all arbitrary strings that can
 * look like JSON. Reusing it would let an attacker execute arguments that differ from the
 * approved ones under the same digest. That is the same-id substitution hole the record
 * exists to close.
 */

export class StrictSerializationError extends Error {
  readonly pointer: string;

  constructor(message: string, pointer: string) {
    super(pointer === "" ? message : `${message} (at ${pointer})`);
    this.name = "StrictSerializationError";
    this.pointer = pointer;
  }
}

function reject(message: string, pointer: string): never {
  throw new StrictSerializationError(message, pointer);
}

/**
 * Serialize a value to its exact canonical JSON text.
 *
 * Rejection is an error, never a fallback: the runner must not degrade to a weaker key when
 * this refuses a value (contract 2.3.4).
 */
export function strictCanonicalJson(value: unknown): string {
  return encode(value, "", new Set());
}

function encode(value: unknown, pointer: string, seen: Set<object>): string {
  if (value === null) return "null";

  const type = typeof value;

  if (type === "boolean") return value ? "true" : "false";

  if (type === "number") {
    // JSON cannot represent these, and coercing them would make two different values share
    // a digest.
    if (!Number.isFinite(value as number)) {
      reject(
        `the number ${String(value)} is not representable in JSON`,
        pointer,
      );
    }
    // `JSON.stringify` already emits the shortest round-trip form, and turns -0 into 0.
    return JSON.stringify(value as number) as string;
  }

  if (type === "string") {
    // The ONE rule that matters most: a string is serialized as a string literal, always.
    // Its content is never inspected, parsed, trimmed, or type-changed. `JSON.stringify`
    // also escapes a lone surrogate as \uXXXX (well-formed JSON.stringify), so two
    // different strings cannot encode to the same bytes.
    return JSON.stringify(value as string) as string;
  }

  if (type === "undefined") {
    reject("undefined is not representable in JSON", pointer);
  }
  if (type === "function") {
    reject("a function is not representable in JSON", pointer);
  }
  if (type === "symbol") {
    reject("a symbol is not representable in JSON", pointer);
  }
  if (type === "bigint") {
    reject("a BigInt is not representable in JSON", pointer);
  }

  // Everything below is an object.
  const object = value as object;

  if (seen.has(object)) {
    reject("the value holds a cycle", pointer);
  }

  const prototype = Object.getPrototypeOf(object);
  const isArray = Array.isArray(object);

  // A Date, a Map, a Set, a class instance, and a null-prototype object are all rejected.
  // Encoding them would mean choosing a representation, and a chosen representation is a
  // place where two different values can collide.
  if (!isArray && prototype !== Object.prototype) {
    reject(
      `only plain objects and arrays are representable; got ${describe(object)}`,
      pointer,
    );
  }
  if (isArray && prototype !== Array.prototype) {
    reject("an array with a modified prototype is not representable", pointer);
  }

  seen.add(object);
  try {
    if (isArray) {
      // Array order is data, so it is preserved.
      const items = (object as unknown[]).map((item, index) =>
        encode(item, `${pointer}/${index}`, seen),
      );
      return `[${items.join(",")}]`;
    }

    // Own enumerable string keys only: a prototype-chain property must never enter the
    // digest, and neither must a `toJSON` hook, which would let a crafted object choose its
    // own digest input.
    const keys = Object.keys(object).sort(compareCodeUnits);
    const entries = keys.map((key) => {
      const encoded = encode(
        (object as Record<string, unknown>)[key],
        `${pointer}/${escapePointer(key)}`,
        seen,
      );
      return `${JSON.stringify(key)}:${encoded}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(object);
  }
}

/** UTF-16 code-unit order, which is what `<` on JS strings already gives. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapePointer(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function describe(value: object): string {
  const name = Object.getPrototypeOf(value)?.constructor?.name;
  return typeof name === "string" && name !== ""
    ? `a ${name}`
    : "an exotic object";
}
