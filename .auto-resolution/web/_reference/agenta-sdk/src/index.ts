/**
 * Agenta TypeScript SDK
 *
 * Usage:
 *
 *   import { Agenta } from "@/lib/agenta-sdk";
 *
 *   const ag = new Agenta({
 *     host: "http://localhost",
 *     apiKey: "ak-...",
 *     projectId: "...",
 *   });
 *
 *   // Simple API — applications
 *   const apps = await ag.applications.list();
 *   const app = await ag.applications.create({ slug: "my-app", name: "My App" });
 *   await ag.applications.update({ id: app.application!.id!, name: "Renamed" });
 *
 *   // Revisions — version control
 *   const rev = await ag.revisions.retrieveBySlug("my-app");
 *   await ag.revisions.commit({
 *     application_id: app.application!.id!,
 *     data: { parameters: { prompt: { ... } } },
 *     message: "Update prompt",
 *   });
 *
 *   // Evaluators
 *   const evaluator = await ag.evaluators.create({ slug: "my-eval", name: "My Eval" });
 *
 *   // Tracing
 *   const spans = await ag.tracing.querySpans({ filtering: { ... } });
 *
 *   // Evaluations — runs, scenarios, results
 *   const runs = await ag.evaluations.createRuns([{ name: "eval-1", data: { steps, mappings } }]);
 *   const results = await ag.evaluations.queryResults({ result: { run_id: "..." } });
 *   await ag.evaluations.createSimple({ name: "My Eval", data: { ... }, flags: { ... } });
 *
 *   // Workflows — the unified entity behind apps and evaluators
 *   const evaluators = await ag.workflows.listEvaluators();
 *   const evaluator = await ag.workflows.createEvaluator({
 *     slug: "my-eval", name: "Exact Match", data: { uri: "agenta:builtin:auto_exact_match:v0" },
 *   });
 *   await ag.workflows.commitRevision({ workflowId: evaluator.id, data: { ... } });
 *
 *   // Test sets
 *   const ts = await ag.testsets.create({ slug: "my-tests", name: "My Tests", testcases: [...] });
 *   const fetched = await ag.testsets.get(ts.id!);  // testcases inline
 *
 *   // Local evaluation (SDK-managed execution)
 *   await ag.evaluations.postResults([{ run_id, scenario_id, step_key, meta: { score: 0.9 } }]);
 *
 *   // Annotations
 *   await ag.annotations.create({ trace_id: "...", score: 2, label: "too_verbose" });
 *
 *   // Trace query by application
 *   const traces = await ag.tracing.queryByApplication("app-id");
 *
 *   // Compare evaluation runs
 *   const diff = await ag.evaluations.compareRuns(baselineRunId, variantRunId);
 */

import {AIServices} from "./ai-services"
import {Annotations} from "./annotations"
import {ApiKeys} from "./api-keys"
import {Applications} from "./applications"
import {AgentaClient, type AgentaClientConfig} from "./client"
import {Environments} from "./environments"
import {Evaluations} from "./evaluations"
import {Evaluators} from "./evaluators"
import {Folders} from "./folders"
import {Organizations} from "./organizations"
import {Profile} from "./profile"
import {Projects} from "./projects"
import {Prompts} from "./prompts"
import {Queries} from "./queries"
import {Revisions} from "./revisions"
import {TestCases} from "./testcases"
import {TestSets} from "./testsets"
import {Tools} from "./tools"
import {Tracing} from "./trace-queries"
import {Vault} from "./vault"
import {Webhooks} from "./webhooks"
import {Workflows} from "./workflows"
import {Workspaces} from "./workspaces"

export class Agenta {
    readonly client: AgentaClient
    readonly aiServices: AIServices
    readonly annotations: Annotations
    readonly apiKeys: ApiKeys
    readonly applications: Applications
    readonly revisions: Revisions
    readonly evaluators: Evaluators
    readonly tracing: Tracing
    readonly evaluations: Evaluations
    readonly workflows: Workflows
    readonly testsets: TestSets
    readonly environments: Environments
    readonly prompts: Prompts
    readonly testcases: TestCases
    readonly tools: Tools
    readonly vault: Vault
    readonly profile: Profile
    readonly projects: Projects
    readonly folders: Folders
    readonly organizations: Organizations
    readonly queries: Queries
    readonly webhooks: Webhooks
    readonly workspaces: Workspaces

    constructor(config?: AgentaClientConfig) {
        this.client = new AgentaClient(config)
        this.aiServices = new AIServices(this.client)
        this.apiKeys = new ApiKeys(this.client)
        this.applications = new Applications(this.client)
        this.revisions = new Revisions(this.client)
        this.evaluators = new Evaluators(this.client)
        this.tracing = new Tracing(this.client)
        this.evaluations = new Evaluations(this.client)
        this.workflows = new Workflows(this.client)
        this.testsets = new TestSets(this.client)
        this.annotations = new Annotations(this.client)
        this.environments = new Environments(this.client)
        this.prompts = new Prompts(
            this.client,
            this.applications,
            this.revisions,
            this.environments,
        )
        this.testcases = new TestCases(this.client)
        this.tools = new Tools(this.client)
        this.vault = new Vault(this.client)
        this.profile = new Profile(this.client)
        this.projects = new Projects(this.client)
        this.folders = new Folders(this.client)
        this.organizations = new Organizations(this.client)
        this.queries = new Queries(this.client)
        this.webhooks = new Webhooks(this.client)
        this.workspaces = new Workspaces(this.client)
    }
}

// Re-export everything
export {AIServices} from "./ai-services"
export {ApiKeys} from "./api-keys"
export {
    AgentaClient,
    AgentaApiError,
    AgentaAuthError,
    AgentaNotFoundError,
    AgentaValidationError,
    AgentaRateLimitError,
    AgentaServerError,
} from "./client"
export type {AgentaClientConfig, AuthProvider} from "./client"
export {loadFromJson, loadFromYaml} from "./file-config"
export {Applications} from "./applications"
export {Revisions} from "./revisions"
export {Evaluators} from "./evaluators"
export {Tracing} from "./trace-queries"
export {Evaluations} from "./evaluations"
export {Workflows} from "./workflows"
export {TestSets} from "./testsets"
export {Annotations} from "./annotations"
export {Environments} from "./environments"
export {Prompts} from "./prompts"
export {TestCases} from "./testcases"
export {Tools} from "./tools"
export {Vault} from "./vault"
export {Profile} from "./profile"
export {Projects} from "./projects"
export {Folders} from "./folders"
export {Organizations} from "./organizations"
export {Queries} from "./queries"
export {Webhooks} from "./webhooks"
export {Workspaces} from "./workspaces"
export type {
    PromptFetchOptions,
    PromptFetchResult,
    PromptPushOptions,
    PromptPushResult,
    ToolSchema,
    PromptModule,
} from "./prompts"
export type * from "./types"

// Optimization utilities
export {
    generateTestCases,
    generateVariant,
    generateCandidates,
    simulateConversation,
    generateTestCasesInputSchema,
    generateVariantInputSchema,
    generateCandidatesInputSchema,
} from "./optimization"
export type {
    GenerateTestCasesInput,
    GenerateTestCasesOutput,
    GenerateVariantInput,
    GenerateVariantOutput,
    GenerateCandidatesInput,
    GenerateCandidatesOutput,
    SimulateConversationInput,
    SimulateConversationOutput,
    ConversationTurn,
    ScenarioRun,
} from "./optimization"
