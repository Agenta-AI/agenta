/**
 * Shared JSON-Schema helpers for resolved tool specs.
 *
 * The platform tool catalog emits snake_case `input_schema` (`static_catalog.py`,
 * `op_catalog.py`), while the wire type `ResolvedToolSpec.inputSchema` is camelCase
 * (`protocol.ts`). `customTools` arrives unnormalized, so every place that reads a spec's
 * schema or validates a call's arguments used to re-implement the same camel/snake accessor and
 * the same required-field walk. They lived as byte-identical copies in `dispatch.ts`, `relay.ts`,
 * and `extensions/agenta.ts`. This module owns them ONCE so a fix (e.g. how a required field is
 * detected, or that snake_case `input_schema` must be read) is a one-line edit, not several.
 *
 * `specInputSchema` is the single accessor for a spec's input schema — use it instead of reading
 * `spec.inputSchema` directly, or a snake_case `input_schema` spec advertises an EMPTY schema to
 * the model (the live bug that hit every platform-catalog tool over the Claude MCP channel).
 */
import type { ResolvedToolSpec } from "../protocol.ts";

/** A value usable as a JSON-Schema object node (`{type:"object", ...}`), or undefined. */
export function objectSchema(schema: unknown): Record<string, unknown> | undefined {
  return schema && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as Record<string, unknown>)
    : undefined;
}

/** The `required` field names declared on a JSON-Schema object node. */
export function requiredFields(schema: unknown): string[] {
  const object = objectSchema(schema);
  const required = object?.required;
  return Array.isArray(required)
    ? required.filter((field): field is string => typeof field === "string")
    : [];
}

/**
 * A spec's input schema, reading camelCase `inputSchema` first and falling back to snake_case
 * `input_schema` (the un-normalized platform-catalog shape). THE single accessor — never read
 * `spec.inputSchema` directly.
 */
export function specInputSchema(
  spec: ResolvedToolSpec,
): Record<string, unknown> | null | undefined {
  return (
    spec.inputSchema ??
    (spec as ResolvedToolSpec & { input_schema?: Record<string, unknown> | null })
      .input_schema
  );
}

/** Dotted paths of every required field the value is missing, walking nested objects. */
export function missingRequiredFields(
  schema: unknown,
  value: unknown,
  path: string[] = [],
): string[] {
  const object = objectSchema(schema);
  if (!object) return [];

  const missing: string[] = [];
  const required = requiredFields(object);
  const record = objectSchema(value);
  for (const field of required) {
    if (!record || record[field] === undefined || record[field] === null) {
      missing.push([...path, field].join("."));
    }
  }

  const properties = objectSchema(object.properties);
  if (!properties || !record) return missing;
  for (const [field, childSchema] of Object.entries(properties)) {
    if (record[field] !== undefined && record[field] !== null) {
      missing.push(...missingRequiredFields(childSchema, record[field], [...path, field]));
    }
  }
  return missing;
}

/**
 * Throw a model-actionable error if a tool call is missing any required argument. Every call site
 * turns the throw into a tool-error result so the model retries with the fields populated, rather
 * than the harness silently dispatching an under-specified call.
 */
export function assertRequiredArguments(spec: ResolvedToolSpec, params: unknown): void {
  const missing = missingRequiredFields(specInputSchema(spec), params);
  if (missing.length === 0) return;
  throw new Error(
    `Tool '${spec.name}' missing required argument(s): ${missing.join(", ")}. ` +
      "Retry the tool call with those argument fields populated.",
  );
}
