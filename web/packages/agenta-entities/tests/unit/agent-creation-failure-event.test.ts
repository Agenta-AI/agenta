/**
 * Unit tests for the `agent_create_failed` reporter seam.
 *
 * `createEphemeralAppFromTemplate` returns `null` at eight places and every one of them reaches
 * the user as the same sentence, so production cannot tell them apart (issue #6992). These tests
 * pin which `reason` each exit reports, and pin the payload to its allowlist: a free-text field
 * slipping in is what would turn this telemetry into a PII surface.
 */
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {
    fetchHarnessCapabilitiesMock,
    fetchSubscriptionStatusMock,
    fetchVaultSecretMock,
    fetchWorkflowCatalogTemplatesMock,
    inspectWorkflowMock,
} = vi.hoisted(() => ({
    fetchHarnessCapabilitiesMock: vi.fn(),
    fetchSubscriptionStatusMock: vi.fn(),
    fetchVaultSecretMock: vi.fn(),
    fetchWorkflowCatalogTemplatesMock: vi.fn(),
    inspectWorkflowMock: vi.fn(),
}))

vi.mock("../../src/secret/api", () => ({
    fetchVaultSecret: fetchVaultSecretMock,
}))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {
        ...actual,
        fetchHarnessCapabilities: fetchHarnessCapabilitiesMock,
        fetchSubscriptionStatus: fetchSubscriptionStatusMock,
        fetchWorkflowCatalogTemplates: fetchWorkflowCatalogTemplatesMock,
        inspectWorkflow: inspectWorkflowMock,
    }
})

import {
    reportAgentCreationFailure,
    setAgentCreationFailureReporter,
    type AgentCreationFailurePayload,
} from "../../src/workflow/state/agentCreationTelemetry"
import {agentCreationPrefsAtom} from "../../src/workflow/state/agentCreationPrefs"
import {createEphemeralAppFromTemplate} from "../../src/workflow/state/appUtils"

const PROJECT_ID = "proj-1"
const USER = {id: "user-1", uid: "user-1", username: "tester", email: "tester@example.com"}

const CAPABILITIES = {
    pi_core: {
        providers: ["openai"],
        deployments: ["direct"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["openai/gpt-5"]},
        default_models: {openai: ["openai/gpt-5"]},
    },
}

const agentTemplate = () => ({
    key: "agent",
    data: {
        uri: "agenta:builtin:agent:v0",
        parameters: {agent: {harness: {kind: "pi_core"}}},
        schemas: {inputs: null, outputs: null, parameters: null},
    },
})

/** Every key the event is allowed to carry. Anything outside this set is a leak. */
const ALLOWED_KEYS = [
    "reason",
    "stage",
    "type",
    "elapsed_ms",
    "project_id",
    "provider_connections",
    "harness_catalog",
    "subscription_status",
    "status",
    "candidate_count",
]

const reporter = vi.fn<(payload: AgentCreationFailurePayload) => void>()

const onlyPayload = (): AgentCreationFailurePayload => {
    expect(reporter).toHaveBeenCalledTimes(1)
    return reporter.mock.calls[0][0]
}

const expectKeys = (payload: AgentCreationFailurePayload, keys: string[]) => {
    expect(Object.keys(payload).sort()).toEqual([...keys].sort())
    expect(keys.filter((key) => !ALLOWED_KEYS.includes(key))).toEqual([])
}

describe("agent_create_failed", () => {
    beforeEach(() => {
        const store = getDefaultStore()
        store.set(queryClientAtom, new QueryClient())
        store.set(projectIdAtom, PROJECT_ID)
        store.set(userAtom, USER)
        store.set(agentCreationPrefsAtom, {version: 1})
        fetchVaultSecretMock.mockReset()
        fetchVaultSecretMock.mockResolvedValue([])
        fetchHarnessCapabilitiesMock.mockReset()
        fetchHarnessCapabilitiesMock.mockResolvedValue(CAPABILITIES)
        fetchSubscriptionStatusMock.mockReset()
        fetchSubscriptionStatusMock.mockResolvedValue({runner: "connected", harnesses: {}})
        fetchWorkflowCatalogTemplatesMock.mockReset()
        fetchWorkflowCatalogTemplatesMock.mockResolvedValue({
            count: 1,
            templates: [agentTemplate()],
        })
        inspectWorkflowMock.mockReset()
        inspectWorkflowMock.mockRejectedValue(new Error("no network in unit tests"))
        reporter.mockReset()
        setAgentCreationFailureReporter(reporter)
    })

    afterEach(() => {
        setAgentCreationFailureReporter(null)
    })

    it("stays silent when creation succeeds", async () => {
        fetchSubscriptionStatusMock.mockResolvedValue({
            runner: "connected",
            harnesses: {pi_core: {state: "ready", provider: "openai"}},
        })

        expect(await createEphemeralAppFromTemplate({type: "agent"})).not.toBeNull()
        expect(reporter).not.toHaveBeenCalled()
    })

    it("reports an abort seen at entry", async () => {
        const controller = new AbortController()
        controller.abort()

        expect(
            await createEphemeralAppFromTemplate({type: "agent", signal: controller.signal}),
        ).toBeNull()

        const payload = onlyPayload()
        expect(payload.reason).toBe("aborted")
        expect(payload.stage).toBe("entry")
        expectKeys(payload, ["reason", "stage", "type", "elapsed_ms", "project_id"])
    })

    it("reports a missing project", async () => {
        getDefaultStore().set(projectIdAtom, null)

        expect(await createEphemeralAppFromTemplate({type: "agent"})).toBeNull()

        const payload = onlyPayload()
        expect(payload.reason).toBe("no_project")
        expectKeys(payload, ["reason", "type", "elapsed_ms"])
    })

    it("reports a rejected templates fetch without the error message", async () => {
        fetchWorkflowCatalogTemplatesMock.mockRejectedValue(
            new Error("catalog down for tester@example.com"),
        )

        expect(await createEphemeralAppFromTemplate({type: "agent"})).toBeNull()

        const payload = onlyPayload()
        expect(payload.reason).toBe("templates_fetch_failed")
        expectKeys(payload, ["reason", "type", "elapsed_ms", "project_id"])
        expect(JSON.stringify(payload)).not.toContain("tester@example.com")
    })

    it("reports a catalog with no template for the requested type", async () => {
        fetchWorkflowCatalogTemplatesMock.mockResolvedValue({count: 0, templates: []})

        expect(await createEphemeralAppFromTemplate({type: "agent"})).toBeNull()

        const payload = onlyPayload()
        expect(payload.reason).toBe("no_template")
        expectKeys(payload, ["reason", "type", "elapsed_ms", "project_id"])
    })

    it("reports a user hydration that never lands", async () => {
        vi.useFakeTimers()
        try {
            getDefaultStore().set(userAtom, null)
            const creation = createEphemeralAppFromTemplate({type: "agent"})
            await vi.advanceTimersByTimeAsync(10_000)

            expect(await creation).toBeNull()
        } finally {
            vi.useRealTimers()
        }

        const payload = onlyPayload()
        expect(payload.reason).toBe("user_timeout")
        expectKeys(payload, ["reason", "type", "elapsed_ms", "project_id"])
    })

    it("reports which model source failed, with its HTTP status", async () => {
        fetchHarnessCapabilitiesMock.mockRejectedValue(
            Object.assign(new Error("catalog unavailable"), {response: {status: 503}}),
        )

        expect(await createEphemeralAppFromTemplate({type: "agent"})).toBeNull()

        const payload = onlyPayload()
        expect(payload).toMatchObject({
            reason: "sources_not_ready",
            type: "agent",
            project_id: PROJECT_ID,
            provider_connections: "ok",
            harness_catalog: "error",
            subscription_status: "ok",
            status: 503,
            candidate_count: 0,
        })
        expectKeys(payload, [
            "reason",
            "type",
            "elapsed_ms",
            "project_id",
            "provider_connections",
            "harness_catalog",
            "subscription_status",
            "status",
            "candidate_count",
        ])
        expect(JSON.stringify(payload)).not.toContain("catalog unavailable")
    })

    it("reports status 0 for an error that carries no HTTP status", async () => {
        fetchVaultSecretMock.mockRejectedValue(new Error("Failed to fetch"))

        expect(await createEphemeralAppFromTemplate({type: "agent"})).toBeNull()

        const payload = onlyPayload()
        expect(payload).toMatchObject({
            reason: "sources_not_ready",
            provider_connections: "error",
            harness_catalog: "ok",
            status: 0,
        })
    })

    it("carries the requested type for a non-agent creation", async () => {
        fetchWorkflowCatalogTemplatesMock.mockResolvedValue({count: 0, templates: []})

        expect(await createEphemeralAppFromTemplate({type: "chat"})).toBeNull()

        expect(onlyPayload().type).toBe("chat")
    })

    it("measures elapsed time from the start of the call", async () => {
        fetchWorkflowCatalogTemplatesMock.mockResolvedValue({count: 0, templates: []})

        await createEphemeralAppFromTemplate({type: "agent"})

        expect(onlyPayload().elapsed_ms).toBeGreaterThanOrEqual(0)
    })

    it("does no reporting when no reporter is installed", () => {
        setAgentCreationFailureReporter(null)

        expect(() =>
            reportAgentCreationFailure({reason: "no_project", type: "agent", elapsed_ms: 1}),
        ).not.toThrow()
    })

    it("swallows a reporter that throws instead of failing the creation", async () => {
        reporter.mockImplementation(() => {
            throw new Error("posthog exploded")
        })
        fetchWorkflowCatalogTemplatesMock.mockResolvedValue({count: 0, templates: []})

        await expect(createEphemeralAppFromTemplate({type: "agent"})).resolves.toBeNull()
        expect(reporter).toHaveBeenCalledTimes(1)
    })
})
