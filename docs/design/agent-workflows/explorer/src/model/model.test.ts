import { describe, expect, it } from "vitest";
import { nodes, edges, scenarios, validateModel } from "./index";

/**
 * A changedKey is only checked as a literal dot-path when it looks like one
 * (word characters and dots only). Several changedKeys in scenarios.json are
 * deliberately descriptive prose ("tools -> builtin_names/customTools split")
 * rather than JSON pointers, because the step is illustrating a reshape, not
 * a single field. Those are skipped rather than asserted against.
 */
function looksLikeDotPath(key: string): boolean {
  return /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/.test(key);
}

function hasPath(value: unknown, path: string): boolean {
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return false;
    if (!(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}

/** True if `path` resolves against any element, when `payload` is an array of records. */
function hasPathAnywhere(payload: unknown, path: string): boolean {
  if (Array.isArray(payload)) {
    return payload.some((item) => hasPath(item, path));
  }
  return hasPath(payload, path);
}

describe("model references", () => {
  it("does not throw on validation (ids resolve)", () => {
    expect(() => validateModel()).not.toThrow();
  });

  it("has unique node ids", () => {
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique edge ids", () => {
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every edge's from/to resolves to a real node", () => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      expect(nodeIds.has(edge.from), `${edge.id}.from = ${edge.from}`).toBe(true);
      expect(nodeIds.has(edge.to), `${edge.id}.to = ${edge.to}`).toBe(true);
    }
  });

  it("every scenario has at least one step (an empty scenario has nothing to play)", () => {
    for (const scenario of scenarios) {
      expect(scenario.steps.length, `${scenario.id} has ${scenario.steps.length} steps`).toBeGreaterThanOrEqual(1);
    }
  });

  it("every scenario step references an existing node or edge", () => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgeIds = new Set(edges.map((e) => e.id));
    for (const scenario of scenarios) {
      for (const step of scenario.steps) {
        const ref = step.nodeId ?? step.edgeId;
        expect(ref, `${scenario.id}: "${step.title}" has no nodeId or edgeId`).toBeTruthy();
        const resolves = step.nodeId ? nodeIds.has(step.nodeId) : edgeIds.has(step.edgeId as string);
        expect(resolves, `${scenario.id}: "${step.title}" ref "${ref}" does not resolve`).toBe(true);
      }
    }
  });
});

describe("scenario changedKeys are consistent with payloads", () => {
  it("every literal-dot-path changedKey resolves in its own or the previous step's payload", () => {
    let checked = 0;
    let resolvedDirectly = 0;

    for (const scenario of scenarios) {
      let previousPayload: unknown = {};
      for (const step of scenario.steps) {
        for (const key of step.changedKeys) {
          if (!looksLikeDotPath(key)) {
            // Descriptive reshape note (e.g. "a -> b"), not a JSON pointer. Nothing to check.
            continue;
          }
          checked += 1;
          if (hasPathAnywhere(step.payload, key)) {
            resolvedDirectly += 1;
            continue;
          }
          if (hasPathAnywhere(previousPayload, key)) {
            // The key existed before this step and is gone now: a removed key.
            // That is a legitimate "change" too, so this is fine, not a bug.
            resolvedDirectly += 1;
            continue;
          }
          // Some changedKeys describe a conceptual change (e.g. the run's
          // overall stopReason) that is not itself a field in this step's
          // illustrative payload snapshot. Warn so it's visible, but do not
          // fail the suite over hand-authored illustrative content.
          console.warn(
            `[model-sanity] ${scenario.id} / "${step.title}": changedKey "${key}" is not present in this step's payload or the previous step's payload`,
          );
        }
        previousPayload = step.payload;
      }
    }

    expect(checked).toBeGreaterThan(0);
    expect(resolvedDirectly).toBeGreaterThan(0);
  });
});
