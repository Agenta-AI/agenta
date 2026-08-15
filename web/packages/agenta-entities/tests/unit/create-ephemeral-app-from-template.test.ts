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
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchWorkflowCatalogTemplatesMock, inspectWorkflowMock} = vi.hoisted(() => ({
    fetchWorkflowCatalogTemplatesMock: vi.fn(),
    inspectWorkflowMock: vi.fn(),
}))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {
        ...actual,
        fetchWorkflowCatalogTemplates: fetchWorkflowCatalogTemplatesMock,
        inspectWorkflow: inspectWorkflowMock,
    }
})

import {agentCreationPrefsAtom} from "../../src/workflow/state/agentCreationPrefs"
import {createEphemeralAppFromTemplate} from "../../src/workflow/state/appUtils"
import {workflowLocalServerDataAtomFamily} from "../../src/workflow/state/store"

const PROJECT_ID = "proj-1"

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
        store.set(agentCreationPrefsAtom, {version: 1})
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

    it("preserves the tools when the last-used-harness preference rewrites harness.kind", async () => {
        getDefaultStore().set(agentCreationPrefsAtom, {version: 1, harness: "claude"})

        const localId = await createEphemeralAppFromTemplate({type: "agent"})
        const agent = readAgentConfig(localId!)

        expect(agent.harness).toEqual({kind: "claude"})
        expect(agent.tools).toEqual(PI_DEFAULT_BUILTINS)
    })

    it("preserves the tools when the model/provider preferences are applied too", async () => {
        getDefaultStore().set(agentCreationPrefsAtom, {
            version: 1,
            harness: "pi_agenta",
            model: "claude-opus-4",
            provider: "anthropic",
            connectionMode: "self_managed",
        })

        const localId = await createEphemeralAppFromTemplate({type: "agent"})
        const agent = readAgentConfig(localId!)

        expect(agent.llm).toMatchObject({model: "claude-opus-4", provider: "anthropic"})
        expect(agent.tools).toEqual(PI_DEFAULT_BUILTINS)
    })

    it("preserves the tools on the deferred-inspect path (playground onboarding)", async () => {
        const localId = await createEphemeralAppFromTemplate({type: "agent", deferInspect: true})
        expect(readAgentConfig(localId!).tools).toEqual(PI_DEFAULT_BUILTINS)
    })
})
