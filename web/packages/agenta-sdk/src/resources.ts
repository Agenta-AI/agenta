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
import {EvaluationsClient} from "@agentaai/api-client/resources/evaluations"
import {EventsClient} from "@agentaai/api-client/resources/events"
import {SecretsClient} from "@agentaai/api-client/resources/secrets"
import {TestsetsClient} from "@agentaai/api-client/resources/testsets"
import {ToolsClient} from "@agentaai/api-client/resources/tools"
import {TracesClient} from "@agentaai/api-client/resources/traces"
import {WorkflowsClient} from "@agentaai/api-client/resources/workflows"

import {buildClientOptions} from "./config"

let _traces: TracesClient | undefined
export function getTracesClient(): TracesClient {
    return (_traces ??= new TracesClient(buildClientOptions()))
}

let _tools: ToolsClient | undefined
export function getToolsClient(): ToolsClient {
    return (_tools ??= new ToolsClient(buildClientOptions()))
}

let _secrets: SecretsClient | undefined
export function getSecretsClient(): SecretsClient {
    return (_secrets ??= new SecretsClient(buildClientOptions()))
}

let _workflows: WorkflowsClient | undefined
export function getWorkflowsClient(): WorkflowsClient {
    return (_workflows ??= new WorkflowsClient(buildClientOptions()))
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
