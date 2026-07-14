import {QueryClient} from "@tanstack/react-query"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchAgentBuildKitOverlayMock} = vi.hoisted(() => ({
    fetchAgentBuildKitOverlayMock: vi.fn(),
}))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {
        ...actual,
        fetchAgentBuildKitOverlay: fetchAgentBuildKitOverlayMock,
    }
})

import {AGENT_BUILD_KIT_WORKFLOW_SLUG} from "../../src/workflow/api"
import type {Workflow} from "../../src/workflow/core"
import {
    agentBuildKitOverlayAtom,
    workflowAgentTemplateOverlayAtomFamily,
    workflowLocalServerDataAtomFamily,
} from "../../src/workflow/state/store"

const PROJECT_ID = "proj-1"
const SLUG_QUERY_KEY = ["agentBuildKitOverlay", AGENT_BUILD_KIT_WORKFLOW_SLUG, PROJECT_ID]

const SLUG_OVERLAY = {
    tools: [{op: "read_file", type: "platform"}],
    sandbox: {permissions: {write_files: "allow"}},
}

const FALLBACK_OVERLAY = {
    tools: [{op: "legacy_app_context", type: "platform"}],
    sandbox: {permissions: {execute_code: "allow"}},
}

function makeStore({
    session = true,
    seedSlugOverlay = true,
}: {session?: boolean; seedSlugOverlay?: boolean} = {}) {
    const queryClient = new QueryClient()
    const store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT_ID)
    store.set(sessionAtom, session)

    if (seedSlugOverlay) {
        queryClient.setQueryData(SLUG_QUERY_KEY, SLUG_OVERLAY)
    }

    return {store, queryClient}
}

function seedLocalDraft(
    store: ReturnType<typeof createStore>,
    id: string,
    workflow: Partial<Workflow>,
) {
    store.set(workflowLocalServerDataAtomFamily(id), {
        id,
        flags: {},
        data: {},
        ...workflow,
    } as Workflow)
}

function seedCommittedRevision(
    queryClient: QueryClient,
    revision: Pick<Workflow, "id"> & Partial<Workflow>,
) {
    queryClient.setQueryData(["workflows", "revision", revision.id, PROJECT_ID], {
        flags: {},
        data: {},
        ...revision,
    } as Workflow)
}

function seedFallbackApp(queryClient: QueryClient, applicationId: string) {
    queryClient.setQueryData(["simpleApplication", applicationId, PROJECT_ID], {
        count: 1,
        additional_context: {
            playground_build_kit: {
                agent_template_overlay: FALLBACK_OVERLAY,
            },
        },
    })
}

async function waitForAssertion(assertion: () => void) {
    const startedAt = Date.now()
    let lastError: unknown
    while (Date.now() - startedAt < 1000) {
        try {
            assertion()
            return
        } catch (error) {
            lastError = error
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
    throw lastError
}

describe("workflowAgentTemplateOverlayAtomFamily", () => {
    beforeEach(() => {
        fetchAgentBuildKitOverlayMock.mockReset()
        workflowAgentTemplateOverlayAtomFamily.setShouldRemove(() => true)
        workflowAgentTemplateOverlayAtomFamily.setShouldRemove(null)
        workflowLocalServerDataAtomFamily.setShouldRemove(() => true)
        workflowLocalServerDataAtomFamily.setShouldRemove(null)
    })

    it("returns the slug-fetched overlay for an agent-typed ephemeral draft", () => {
        const {store} = makeStore()
        seedLocalDraft(store, "local-agent-1", {
            flags: {is_agent: true},
            data: {uri: "agenta:builtin:agent:v0"},
        })

        const overlay = store.get(workflowAgentTemplateOverlayAtomFamily("local-agent-1"))

        expect(overlay).toEqual(SLUG_OVERLAY)
    })

    it("returns the slug-fetched overlay for a committed agent revision", () => {
        const {store, queryClient} = makeStore()
        seedCommittedRevision(queryClient, {
            id: "rev-agent-1",
            workflow_id: "wf-agent-1",
            flags: {is_agent: true},
            data: {uri: "agenta:builtin:agent:v0"},
        })

        const overlay = store.get(workflowAgentTemplateOverlayAtomFamily("rev-agent-1"))

        expect(overlay).toEqual(SLUG_OVERLAY)
    })

    it("uses the agent builtin URI fallback when flags are missing", () => {
        const {store} = makeStore()
        seedLocalDraft(store, "local-agent-uri-only", {
            flags: {},
            data: {uri: "agenta:builtin:agent:v0"},
        })

        const overlay = store.get(workflowAgentTemplateOverlayAtomFamily("local-agent-uri-only"))

        expect(overlay).toEqual(SLUG_OVERLAY)
    })

    it("returns null for a non-agent entity", () => {
        const {store} = makeStore()
        seedLocalDraft(store, "local-prompt-1", {
            flags: {is_agent: false, is_evaluator: true},
            data: {uri: "agenta:builtin:auto_exact_match:v0"},
        })

        const overlay = store.get(workflowAgentTemplateOverlayAtomFamily("local-prompt-1"))

        expect(overlay).toBeNull()
    })

    it("returns null when there is no session", () => {
        const {store} = makeStore({session: false, seedSlugOverlay: false})
        seedLocalDraft(store, "local-agent-no-session", {
            flags: {is_agent: true},
            data: {uri: "agenta:builtin:agent:v0"},
        })

        const overlay = store.get(workflowAgentTemplateOverlayAtomFamily("local-agent-no-session"))

        expect(overlay).toBeNull()
    })

    it("uses the per-app fallback when the slug fetch returns empty and workflow_id exists", () => {
        const {store, queryClient} = makeStore({seedSlugOverlay: false})
        queryClient.setQueryData(SLUG_QUERY_KEY, null)
        seedCommittedRevision(queryClient, {
            id: "rev-agent-fallback",
            workflow_id: "wf-agent-fallback",
            flags: {is_agent: true},
            data: {uri: "agenta:builtin:agent:v0"},
        })
        seedFallbackApp(queryClient, "wf-agent-fallback")

        const overlay = store.get(workflowAgentTemplateOverlayAtomFamily("rev-agent-fallback"))

        expect(overlay).toEqual(FALLBACK_OVERLAY)
    })

    it("uses the per-app fallback when the slug fetch errors and workflow_id exists", async () => {
        const {store, queryClient} = makeStore({seedSlugOverlay: false})
        fetchAgentBuildKitOverlayMock.mockRejectedValueOnce(new Error("slug fetch failed"))
        seedCommittedRevision(queryClient, {
            id: "rev-agent-error-fallback",
            workflow_id: "wf-agent-error-fallback",
            flags: {is_agent: true},
            data: {uri: "agenta:builtin:agent:v0"},
        })
        seedFallbackApp(queryClient, "wf-agent-error-fallback")

        const unsubscribe = store.sub(agentBuildKitOverlayAtom, () => {})
        try {
            store.get(workflowAgentTemplateOverlayAtomFamily("rev-agent-error-fallback"))
            await waitForAssertion(() => {
                expect(store.get(agentBuildKitOverlayAtom).isError).toBe(true)
            })

            const overlay = store.get(
                workflowAgentTemplateOverlayAtomFamily("rev-agent-error-fallback"),
            )

            expect(overlay).toEqual(FALLBACK_OVERLAY)
        } finally {
            unsubscribe()
        }
    })
})
