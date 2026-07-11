/**
 * Hand-written types for the six model JSON files under src/model/*.json.
 * These files are generated upstream (treat as source of truth); this module
 * only describes their shape so the rest of the app gets type safety.
 */

export type NodeTier = "edge" | "service" | "runner" | "sandbox" | "platform";
export type NodeStatus = "real" | "gap" | "experimental";

export interface TopologyNode {
  id: string;
  label: string;
  aliases: string[];
  tier: NodeTier;
  role: string;
  owns: string[];
  codePath: string;
  docPath: string;
  status: NodeStatus;
  notes: string;
}

export interface NodesModel {
  $schema: string;
  nodes: TopologyNode[];
}

export interface TopologyEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  protocol: string;
  docPath: string;
  notes: string;
}

export interface EdgesModel {
  $schema: string;
  edges: TopologyEdge[];
}

export interface Citation {
  docPath?: string;
  codePath?: string;
  section?: string;
  note?: string;
  constants?: Record<string, number>;
}

/** A scenario step references either a node or an edge, never both. */
export interface ScenarioStepBase {
  title: string;
  description: string;
  payload: unknown;
  changedKeys: string[];
  citations: Citation[];
}

export interface ScenarioNodeStep extends ScenarioStepBase {
  nodeId: string;
  edgeId?: undefined;
}

export interface ScenarioEdgeStep extends ScenarioStepBase {
  edgeId: string;
  nodeId?: undefined;
}

export type ScenarioStep = ScenarioNodeStep | ScenarioEdgeStep;

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  docPath: string;
  steps: ScenarioStep[];
}

export interface ScenariosModel {
  $schema: string;
  scenarios: Scenario[];
}

export type PolicyDefault = "allow" | "ask" | "deny" | "allow_reads";

export interface PermissionPrecedenceStep {
  step: number;
  id: string;
  description: string;
}

export interface PermissionVerdictLadderEntry {
  permission: string;
  verdict: string;
  description: string;
}

export interface PermissionGate {
  id: string;
  label: string;
  appliesTo: string[];
  description: string;
}

export interface ToolExample {
  name: string;
  kind: string;
  readOnlyHint: boolean | null | string;
  harness: string;
  notes: string;
}

export interface PermissionTestVectorGate {
  toolName: string;
  readOnlyHint?: boolean;
  specPermission?: string;
  serverPermission?: string;
  args?: Record<string, unknown>;
}

export interface PermissionTestVectorConfig {
  permissions: unknown;
  env?: Record<string, string>;
  storedDecision?: string;
}

export interface PermissionTestVector {
  id: string;
  tool: string;
  gate: PermissionTestVectorGate;
  config: PermissionTestVectorConfig;
  expectedVerdict: "allow" | "deny" | "pendingApproval";
  decidedBy: string;
}

export interface PermissionsModel {
  $schema: string;
  sourceOfTruth: string;
  policyDefaults: PolicyDefault[];
  defaultPolicy: PolicyDefault;
  malformedFallback: string;
  malformedFallbackNotes: string;
  killSwitch: {
    envVar: string;
    activatesOn: string;
    effect: string;
    scopeNuance: string;
  };
  precedence: PermissionPrecedenceStep[];
  verdictLadder: PermissionVerdictLadderEntry[];
  gates: PermissionGate[];
  toolExamples: ToolExample[];
  testVectors: PermissionTestVector[];
  citations: Citation[];
}

export interface LoadModelStructuralFact {
  id: string;
  fact: string;
  citations: Citation[];
}

export interface LoadModelStage {
  id: string;
  kind: "fixed" | "queue";
  notes: string;
  illustrativeLatencyMs: { min: number; max: number | null };
  empirical: boolean;
  citations?: Citation[];
}

export interface LoadModel {
  $schema: string;
  disclaimer: string;
  structuralFacts: LoadModelStructuralFact[];
  stages: LoadModelStage[];
}

export interface MetaResolvedAmbiguity {
  topic: string;
  docClaim: string;
  codeFinding: string;
  resolution: string;
  citations: Citation[];
}

export interface MetaGap {
  id: string;
  summary: string;
  docPath: string;
}

export interface MetaModel {
  $schema: string;
  generatedAt: string;
  sourceCommit: string;
  sourceRepo: string;
  authoritativeSources: {
    documentation: string;
    interfaces: string;
    tieBreaker: string;
    codeVerifiedDirectly: string[];
  };
  namingDrift: { note: string; resolution: string };
  resolvedAmbiguities: MetaResolvedAmbiguity[];
  gaps: MetaGap[];
  docIndex: Record<string, string>;
}
