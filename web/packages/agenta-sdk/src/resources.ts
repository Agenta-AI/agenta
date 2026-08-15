/**
 * Per-resource Fern client accessors.
 *
 * Each accessor imports a single resource client via the `@agentaai/api-client`
 * `./resources/*` subpath and lazily constructs a host-pinned singleton. Because
 * this module never references the monolithic `AgentaApiClient`, a consumer that
 * imports only `getTracesClient` pulls just the traces client (+ shared core),
 * not all 27 resource clients. Resource clients self-normalize auth in their own
 * constructors, so they are equivalent to `getAgentaSdkClient().traces` etc.
 */
import {ApplicationsClient} from "@agentaai/api-client/resources/applications"
import {EvaluationsClient} from "@agentaai/api-client/resources/evaluations"
import {EventsClient} from "@agentaai/api-client/resources/events"
import {KeysClient} from "@agentaai/api-client/resources/keys"
import {MountsClient} from "@agentaai/api-client/resources/mounts"
import {ProjectsClient} from "@agentaai/api-client/resources/projects"
import {SecretsClient} from "@agentaai/api-client/resources/secrets"
import {SessionsClient} from "@agentaai/api-client/resources/sessions"
import {TestsetsClient} from "@agentaai/api-client/resources/testsets"
import {ToolsClient} from "@agentaai/api-client/resources/tools"
import {TracesClient} from "@agentaai/api-client/resources/traces"
import {UsersClient} from "@agentaai/api-client/resources/users"
import {WebhooksClient} from "@agentaai/api-client/resources/webhooks"
import {WorkflowsClient} from "@agentaai/api-client/resources/workflows"

import {buildClientOptions, withLowPriorityFetch} from "./config"

let _applications: ApplicationsClient | undefined
export function getApplicationsClient(): ApplicationsClient {
    return (_applications ??= new ApplicationsClient(buildClientOptions()))
}

let _traces: TracesClient | undefined
export function getTracesClient(): TracesClient {
    return (_traces ??= new TracesClient(buildClientOptions()))
}

let _tracesLowPriority: TracesClient | undefined
/** Same host/auth as `getTracesClient`, but requests carry `priority: "low"` —
 * for background hydration that must yield to render-critical traffic. */
export function getLowPriorityTracesClient(): TracesClient {
    return (_tracesLowPriority ??= new TracesClient(withLowPriorityFetch(buildClientOptions())))
}

let _tools: ToolsClient | undefined
export function getToolsClient(): ToolsClient {
    return (_tools ??= new ToolsClient(buildClientOptions()))
}

let _toolsLowPriority: ToolsClient | undefined
/** Same host/auth as `getToolsClient`, but requests carry `priority: "low"` — for secondary
 * playground data (connections/catalog) that must yield to render-critical traffic. */
export function getLowPriorityToolsClient(): ToolsClient {
    return (_toolsLowPriority ??= new ToolsClient(withLowPriorityFetch(buildClientOptions())))
}

let _secrets: SecretsClient | undefined
export function getSecretsClient(): SecretsClient {
    return (_secrets ??= new SecretsClient(buildClientOptions()))
}

let _keys: KeysClient | undefined
export function getKeysClient(): KeysClient {
    return (_keys ??= new KeysClient(buildClientOptions()))
}

let _users: UsersClient | undefined
export function getUsersClient(): UsersClient {
    return (_users ??= new UsersClient(buildClientOptions()))
}

let _webhooks: WebhooksClient | undefined
export function getWebhooksClient(): WebhooksClient {
    return (_webhooks ??= new WebhooksClient(buildClientOptions()))
}

let _workflows: WorkflowsClient | undefined
export function getWorkflowsClient(): WorkflowsClient {
    return (_workflows ??= new WorkflowsClient(buildClientOptions()))
}

let _workflowsLowPriority: WorkflowsClient | undefined
/** Same host/auth as `getWorkflowsClient`, but requests carry `priority: "low"` — for secondary
 * playground data (e.g. the build-kit overlay) that must yield to render-critical traffic. */
export function getLowPriorityWorkflowsClient(): WorkflowsClient {
    return (_workflowsLowPriority ??= new WorkflowsClient(
        withLowPriorityFetch(buildClientOptions()),
    ))
}

let _testsets: TestsetsClient | undefined
export function getTestsetsClient(): TestsetsClient {
    return (_testsets ??= new TestsetsClient(buildClientOptions()))
}

let _events: EventsClient | undefined
export function getEventsClient(): EventsClient {
    return (_events ??= new EventsClient(buildClientOptions()))
}

let _evaluations: EvaluationsClient | undefined
export function getEvaluationsClient(): EvaluationsClient {
    return (_evaluations ??= new EvaluationsClient(buildClientOptions()))
}

let _sessions: SessionsClient | undefined
export function getSessionsClient(): SessionsClient {
    return (_sessions ??= new SessionsClient(buildClientOptions()))
}

let _sessionsLowPriority: SessionsClient | undefined
/** Same host/auth as `getSessionsClient`, but requests carry `priority: "low"` — for secondary
 * session reads (record-replay hydration, liveness polling) that must yield to the live
 * conversation stream. */
export function getLowPrioritySessionsClient(): SessionsClient {
    return (_sessionsLowPriority ??= new SessionsClient(withLowPriorityFetch(buildClientOptions())))
}

let _projects: ProjectsClient | undefined
export function getProjectsClient(): ProjectsClient {
    return (_projects ??= new ProjectsClient(buildClientOptions()))
}

let _mounts: MountsClient | undefined
export function getMountsClient(): MountsClient {
    return (_mounts ??= new MountsClient(buildClientOptions()))
}

let _mountsLowPriority: MountsClient | undefined
/** Same host/auth as `getMountsClient`, but requests carry `priority: "low"` — for the
 * background mount file listing that must yield to render-critical traffic. */
export function getLowPriorityMountsClient(): MountsClient {
    return (_mountsLowPriority ??= new MountsClient(withLowPriorityFetch(buildClientOptions())))
}
