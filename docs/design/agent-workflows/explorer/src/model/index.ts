/**
 * Single entry point for the six generated model JSON files. Every other module
 * imports the model from here, never from the raw JSON files directly, so the
 * sanity checks below always run before anything renders.
 */
import nodesJson from "./nodes.json";
import edgesJson from "./edges.json";
import scenariosJson from "./scenarios.json";
import permissionsJson from "./permissions.json";
import loadmodelJson from "./loadmodel.json";
import metaJson from "./meta.json";
import type {
  NodesModel,
  EdgesModel,
  ScenariosModel,
  PermissionsModel,
  LoadModel,
  MetaModel,
} from "./types";

export const nodesModel = nodesJson as unknown as NodesModel;
export const edgesModel = edgesJson as unknown as EdgesModel;
export const scenariosModel = scenariosJson as unknown as ScenariosModel;
export const permissionsModel = permissionsJson as unknown as PermissionsModel;
export const loadModel = loadmodelJson as unknown as LoadModel;
export const metaModel = metaJson as unknown as MetaModel;

export const nodes = nodesModel.nodes;
export const edges = edgesModel.edges;
export const scenarios = scenariosModel.scenarios;

const nodeIds = new Set(nodes.map((n) => n.id));
const edgeIds = new Set(edges.map((e) => e.id));

export function nodeById(id: string) {
  return nodes.find((n) => n.id === id);
}

export function edgeById(id: string) {
  return edges.find((e) => e.id === id);
}

export function scenarioById(id: string) {
  return scenarios.find((s) => s.id === id);
}

/**
 * Fails loudly, at import time, if the generated model is internally
 * inconsistent. This runs once per app load and is intentionally strict:
 * a dangling reference here is a data bug, not a rendering concern.
 */
export function validateModel(): void {
  const errors: string[] = [];

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`edge ${edge.id}: from="${edge.from}" does not resolve to a node`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`edge ${edge.id}: to="${edge.to}" does not resolve to a node`);
    }
  }

  for (const scenario of scenarios) {
    scenario.steps.forEach((step, index) => {
      const title = step.title;
      if (step.nodeId !== undefined) {
        if (!nodeIds.has(step.nodeId)) {
          errors.push(
            `scenario ${scenario.id} step ${index} ("${title}"): nodeId="${step.nodeId}" does not resolve to a node`,
          );
        }
      } else if (step.edgeId !== undefined) {
        if (!edgeIds.has(step.edgeId)) {
          errors.push(
            `scenario ${scenario.id} step ${index} ("${title}"): edgeId="${step.edgeId}" does not resolve to an edge`,
          );
        }
      } else {
        errors.push(`scenario ${scenario.id} step ${index} ("${title}"): has neither nodeId nor edgeId`);
      }
    });
  }

  if (errors.length > 0) {
    throw new Error(
      `agent-workflows explorer model failed validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
}

validateModel();

export const docIndex = metaModel.docIndex;
