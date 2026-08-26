/**
 * Unit tests for `createEphemeralAppFromTemplate` — the factory that mints a new agent's local
 * entity from the API catalog's materialized template parameters.
 *
 * The shipped default grants Pi's four built-ins as `parameters.agent.tools` (issue #5590), and
 * this factory is the link between that catalog payload and the config the user commits. It also
 * overlays the last-used-harness preference, which rewrites `harness.kind` and must leave `tools`
 * alone. Nothing covered that before, and a drop here reproduces the "agent has no tools" symptom
 * with every Python test still green.
 */
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

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

import {agentCreationPrefsAtom} from "../../src/workflow/state/agentCreationPrefs"
import {createEphemeralAppFromTemplate} from "../../src/workflow/state/appUtils"
import {workflowLocalServerDataAtomFamily} from "../../src/workflow/state/store"

const PROJECT_ID = "proj-1"
const USER = {
    id: "user-1",
    uid: "user-1",
    username: "tester",
    email: "tester@example.com",
}

const CAPABILITIES = {
    pi_core: {
        providers: ["openai"],
        deployments: ["direct", "custom", "vertex_ai"],
        connection_modes: ["agenta", "self_managed"],
        model_selection: "provider/id",
        models: {openai: ["openai/gpt-5"]},
        default_models: {openai: ["openai/gpt-5"]},
    },
}

const standardConnection = () => ({
    id: "conn-openai",
    type: "provider_key",
    title: "OpenAI",
    displayName: "OpenAI",
    slug: "openai",
    models: ["gpt-5"],
    harnesses: ["pi_core"],
    hasKey: true,
})

const managedConnection = () => ({
    id: "conn-starter",
    type: "custom_provider",
    name: "Agenta",
    displayName: "Agenta",
    provider: "custom",
    slug: "starter-credits",
    models: ["vertex_ai/gemini-3.6-flash"],
    modelKeys: ["Agenta/custom/vertex_ai/gemini-3.6-flash"],
    harnesses: ["pi_core"],
    hasKey: true,
    managementPolicy: "manager_only",
})

/** Pi's default built-in grants, in the typed form the default template ships. */
const PI_DEFAULT_BUILTINS = ["read", "bash", "edit", "write"].map((name) => ({
    type: "builtin",
    name,
}))

const agentTemplate = () => ({
    key: "agent",
    data: {
        uri: "agenta:builtin:agent:v0",
        parameters: {
            agent: {
                harness: {kind: "pi_core"},
                llm: {model: "gpt-5"},
                tools: PI_DEFAULT_BUILTINS.map((tool) => ({...tool})),
            },
        },
        schemas: {inputs: null, outputs: null, parameters: null},
    },
})

/** Minimal shape of the agent config these assertions read off the local entity. */
interface AgentConfigShape {
    harness?: {kind?: string}
    llm?: Record<string, unknown>
    tools?: {type?: string; name?: string}[]
}

function readAgentConfig(localId: string): AgentConfigShape {
    const entity = getDefaultStore().get(workflowLocalServerDataAtomFamily(localId))
    const agent = entity?.data?.parameters?.agent
    if (!agent) throw new Error(`no agent config on the local entity for ${localId}`)
    return agent as AgentConfigShape
}

describe("createEphemeralAppFromTemplate (agent tools)", () => {
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
        // Inspect only refines schemas; the factory falls back to the catalog ones when it fails.
        inspectWorkflowMock.mockRejectedValue(new Error("no network in unit tests"))
    })

    it("preserves the template's built-in tools on the new agent", async () => {
        const localId = await createEphemeralAppFromTemplate({type: "agent"})
        expect(localId).not.toBeNull()
        expect(readAgentConfig(localId!).tools).toEqual(PI_DEFAULT_BUILTINS)
    })

    it("ignores a partial legacy preference instead of guessing a route", async () => {
        getDefaultStore().set(agentCreationPrefsAtom, {version: 1, harness: "claude"})

        const localId = await createEphemeralAppFromTemplate({type: "agent"})
        const agent = readAgentConfig(localId!)

        expect(agent.harness).toEqual({kind: "pi_core"})
        expect(agent.tools).toEqual(PI_DEFAULT_BUILTINS)
    })

    it("keeps a complete runnable last selection ahead of the managed candidate", async () => {
        fetchVaultSecretMock.mockResolvedValue([standardConnection(), managedConnection()])
        getDefaultStore().set(agentCreationPrefsAtom, {
            version: 1,
            harness: "pi_core",
            model: "openai/gpt-5",
            provider: "openai",
            connectionMode: "agenta",
            connectionSlug: "openai",
        })

        const localId = await createEphemeralAppFromTemplate({type: "agent"})
        const agent = readAgentConfig(localId!)

        expect(agent.llm).toMatchObject({
            model: "openai/gpt-5",
            provider: "openai",
            connection: {mode: "agenta", slug: "openai"},
        })
        expect(agent.tools).toEqual(PI_DEFAULT_BUILTINS)
    })

    it("falls from a stale last tuple to the first managed Pi candidate", async () => {
        fetchVaultSecretMock.mockResolvedValue([managedConnection()])
        getDefaultStore().set(agentCreationPrefsAtom, {
            version: 1,
            harness: "codex",
            model: "gpt-stale",
            provider: "openai",
            connectionMode: "agenta",
            connectionSlug: "gone",
        })

        const localId = await createEphemeralAppFromTemplate({type: "agent"})
        const agent = readAgentConfig(localId!)

        expect(agent.harness).toEqual({kind: "pi_core"})
        expect(agent.llm).toEqual({
            model: "Agenta/custom/vertex_ai/gemini-3.6-flash",
            connection: {mode: "agenta", slug: "starter-credits"},
        })
    })

    it("uses the deterministic first runnable connection when there is no saved choice", async () => {
        fetchVaultSecretMock.mockResolvedValue([standardConnection()])

        const localId = await createEphemeralAppFromTemplate({type: "agent"})

        expect(readAgentConfig(localId!).llm).toMatchObject({
            model: "openai/gpt-5",
            connection: {mode: "agenta", slug: "openai"},
        })
    })

    it("uses a ready subscription when it is the first runnable candidate", async () => {
        fetchSubscriptionStatusMock.mockResolvedValue({
            runner: "connected",
            harnesses: {pi_core: {state: "ready", provider: "openai"}},
        })

        const localId = await createEphemeralAppFromTemplate({type: "agent"})

        expect(readAgentConfig(localId!).llm).toEqual({
            model: "openai/gpt-5",
            provider: "openai",
            connection: {mode: "self_managed"},
        })
    })

    it("preserves the tools on the deferred-inspect path (playground onboarding)", async () => {
        const localId = await createEphemeralAppFromTemplate({type: "agent", deferInspect: true})
        expect(readAgentConfig(localId!).tools).toEqual(PI_DEFAULT_BUILTINS)
    })

    it("waits for user hydration before resolving candidates", async () => {
        const store = getDefaultStore()
        store.set(userAtom, null)

        const creation = createEphemeralAppFromTemplate({type: "agent"})
        await Promise.resolve()

        expect(fetchVaultSecretMock).not.toHaveBeenCalled()
        expect(fetchHarnessCapabilitiesMock).not.toHaveBeenCalled()
        expect(fetchSubscriptionStatusMock).not.toHaveBeenCalled()

        store.set(userAtom, USER)
        const localId = await creation

        expect(localId).not.toBeNull()
        expect(fetchVaultSecretMock).toHaveBeenCalledTimes(1)
    })

    it("stops waiting when user hydration never completes", async () => {
        vi.useFakeTimers()
        try {
            getDefaultStore().set(userAtom, null)

            const creation = createEphemeralAppFromTemplate({type: "agent"})
            await vi.advanceTimersByTimeAsync(10_000)

            expect(await creation).toBeNull()
            expect(fetchVaultSecretMock).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
    })

    it("does not mint an agent when a required candidate source fails", async () => {
        fetchHarnessCapabilitiesMock.mockRejectedValue(new Error("catalog unavailable"))

        expect(await createEphemeralAppFromTemplate({type: "agent"})).toBeNull()
    })

    it("uses vault candidates when optional subscription status fails", async () => {
        fetchVaultSecretMock.mockResolvedValue([standardConnection()])
        fetchSubscriptionStatusMock.mockRejectedValue(new Error("runner has no status endpoint"))

        const localId = await createEphemeralAppFromTemplate({type: "agent"})

        expect(localId).not.toBeNull()
        expect(readAgentConfig(localId!).llm).toMatchObject({
            model: "openai/gpt-5",
            connection: {mode: "agenta", slug: "openai"},
        })
    })

    it("does not retry a failed vault lookup during agent creation", async () => {
        const store = getDefaultStore()
        store.set(userAtom, USER)
        store.set(
            queryClientAtom,
            new QueryClient({defaultOptions: {queries: {retry: 3, retryDelay: 0}}}),
        )
        fetchVaultSecretMock.mockRejectedValue(new Error("vault unavailable"))

        await createEphemeralAppFromTemplate({type: "agent"})

        expect(fetchVaultSecretMock).toHaveBeenCalledTimes(1)
    })
})
