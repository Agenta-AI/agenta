/**
 * `useAgentTriggers().defaultReferences` binds a new trigger to the agent by the ARTIFACT
 * slug. It once read the revision's slug (an opaque 12-hex id) and sent it next to the
 * artifact id, so the API saw `application: {id: <agent>, slug: <revision>}`, found the
 * two disagree, and every schedule create from the agent config panel failed (#7517).
 */
import {act, createElement} from "react"

import {createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    revision: {
        workflow_id: "wf-1",
        workflow_variant_id: "var-1",
        slug: "461bf8c42aa4",
    } as Record<string, unknown> | null,
    artifactSlug: "agent-mv0xreqcdp" as string | null,
}))

vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    // Stable atoms: a fresh atom per render would re-subscribe on every render.
    const resolvedData = atom(() => fixture.revision)
    const artifactName = atom(() => "Hotel agent")
    const artifactSlug = atom(() => fixture.artifactSlug)
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                resolvedData: () => resolvedData,
                artifactName: () => artifactName,
                artifactSlug: () => artifactSlug,
            },
        },
    }
})
vi.mock("@agenta/entities/gatewayTrigger", async (original) => ({
    ...(await original<object>()),
    useTriggerSchedules: () => ({schedules: []}),
    useTriggerSubscriptions: () => ({subscriptions: []}),
}))

import {useAgentTriggers} from "../../src/DrillInView/SchemaControls/triggerManagement/useAgentTriggers"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let captured: ReturnType<typeof useAgentTriggers> | null = null

function Probe() {
    captured = useAgentTriggers("rev-1")
    return null
}

// A fresh store per render, so the fixture atoms re-read the fixture.
const renderProbe = () =>
    act(async () =>
        root.render(createElement(Provider, {store: createStore()}, createElement(Probe))),
    )

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    captured = null
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("useAgentTriggers defaultReferences", () => {
    it("names the application by the artifact slug, never the revision slug", async () => {
        fixture.artifactSlug = "agent-mv0xreqcdp"
        await renderProbe()

        expect(captured?.defaultReferences).toEqual({
            application: {id: "wf-1", slug: "agent-mv0xreqcdp"},
            application_variant: {id: "var-1"},
        })
    })

    it("sends only the id while the artifact slug is unknown", async () => {
        fixture.artifactSlug = null
        await renderProbe()

        expect(captured?.defaultReferences).toEqual({
            application: {id: "wf-1"},
            application_variant: {id: "var-1"},
        })
    })
})
