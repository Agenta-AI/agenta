import {atom, createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {projectIdAtom} from "@agenta/shared/state"

const api = vi.hoisted(() => ({commit: vi.fn(), retrieve: vi.fn(), adopt: vi.fn()}))
vi.mock("@agenta/sdk/resources", () => ({
    getWorkflowsClient: () => ({commitWorkflowRevision: api.commit}),
}))
vi.mock("../../src/workflow/api", () => ({retrieveWorkflowRevision: api.retrieve}))
vi.mock("../../src/workflow/state/commit", () => ({invokeWorkflowCommitCallbacks: api.adopt}))
vi.mock("../../src/workflow/state/store", async () => {
    const {atom} = await import("jotai")
    const {atomFamily} = await import("jotai-family")
    const draft = atomFamily(() => atom<unknown>(null))
    return {
        workflowEntityAtomFamily: atomFamily(() => atom<unknown>(null)),
        workflowDraftAtomFamily: draft,
        workflowIsDirtyAtomFamily: atomFamily(() => atom(false)),
        updateWorkflowDraftAtom: atom(null, (_get, set, id: string, data: unknown) =>
            set(draft(id), data),
        ),
        primeWorkflowRevisionDetailCacheImperative: vi.fn(),
        primeCommittedRevisionRefLists: vi.fn(),
        invalidateWorkflowRevisionsByVariantCache: vi.fn(),
    }
})
import {commitAgentCredentialsAtom} from "../../src/workflow/state/agentCredentials"
import {
    workflowEntityAtomFamily,
    workflowIsDirtyAtomFamily,
    workflowDraftAtomFamily,
} from "../../src/workflow/state/store"

const bindings = [
    {secret: {slug: "deploy-key"}, binding: {type: "env" as const, name: "DEPLOY_TOKEN"}},
]
const base = {
    id: "rev-1",
    workflow_id: "workflow-1",
    workflow_variant_id: "variant-1",
    data: {parameters: {agent: {instructions: "Keep this prompt", sandbox: {kind: "daytona"}}}},
}
let store: ReturnType<typeof createStore>
beforeEach(() => {
    vi.resetAllMocks()
    store = createStore()
    store.set(projectIdAtom, "project-1")
    store.set(workflowEntityAtomFamily("rev-1") as ReturnType<typeof atom<typeof base>>, base)
    api.commit.mockImplementation(async ({workflow_revision}) => ({
        workflow_revision: {...base, ...workflow_revision, id: "rev-2"},
    }))
    api.adopt.mockResolvedValue(undefined)
})

describe("secret attachment transaction", () => {
    it("commits reference-only bindings against the pinned base and preserves the agent configuration", async () => {
        await expect(
            store.set(commitAgentCredentialsAtom, {revisionId: "rev-1", bindings}),
        ).resolves.toEqual({revisionId: "rev-2"})
        const [payload, options] = api.commit.mock.calls[0]
        expect(payload.workflow_revision).toMatchObject({
            base_revision_id: "rev-1",
            workflow_variant_id: "variant-1",
            data: {
                parameters: {
                    agent: {
                        instructions: "Keep this prompt",
                        sandbox: {kind: "daytona", credentials: bindings},
                    },
                },
            },
        })
        expect(options.queryParams.project_id).toBe("project-1")
        expect(api.adopt).toHaveBeenCalledWith(expect.objectContaining({newRevisionId: "rev-2"}), {
            revisionId: "rev-1",
        })
    })
    it("does not commit or consume unrelated unsaved edits", async () => {
        store.set(workflowIsDirtyAtomFamily("rev-1") as ReturnType<typeof atom<boolean>>, true)
        await expect(
            store.set(commitAgentCredentialsAtom, {revisionId: "rev-1", bindings}),
        ).rejects.toThrow("Save or discard")
        expect(api.commit).not.toHaveBeenCalled()
    })
    it("recovers a lost success response without creating another revision", async () => {
        api.commit.mockRejectedValue(new Error("Network disconnected"))
        api.retrieve.mockResolvedValue({
            ...base,
            id: "rev-2",
            data: {
                parameters: {
                    agent: {
                        ...base.data.parameters.agent,
                        sandbox: {kind: "daytona", credentials: bindings},
                    },
                },
            },
        })
        await expect(
            store.set(commitAgentCredentialsAtom, {revisionId: "rev-1", bindings}),
        ).resolves.toEqual({revisionId: "rev-2"})
        expect(api.commit).toHaveBeenCalledTimes(1)
    })
    it("does not adopt or overwrite a concurrent configuration change", async () => {
        api.commit.mockRejectedValue(new Error("Revision conflict"))
        api.retrieve.mockResolvedValue({...base, id: "rev-other"})
        await expect(
            store.set(commitAgentCredentialsAtom, {revisionId: "rev-1", bindings}),
        ).rejects.toThrow("Revision conflict")
        expect(api.adopt).not.toHaveBeenCalled()
    })
    it("does not mistake a changed schema for the lost attachment response", async () => {
        api.commit.mockRejectedValue(new Error("Revision conflict"))
        api.retrieve.mockResolvedValue({
            ...base,
            id: "rev-other",
            data: {
                schemas: {inputs: {type: "object"}},
                parameters: {
                    agent: {
                        ...base.data.parameters.agent,
                        sandbox: {kind: "daytona", credentials: bindings},
                    },
                },
            },
        })
        await expect(
            store.set(commitAgentCredentialsAtom, {revisionId: "rev-1", bindings}),
        ).rejects.toThrow("Revision conflict")
        expect(api.adopt).not.toHaveBeenCalled()
    })

    it("preserves edits made during the request on the adopted revision", async () => {
        api.commit.mockImplementation(async ({workflow_revision}) => {
            store.set(workflowDraftAtomFamily("rev-1"), {
                data: {parameters: {agent: {instructions: "Typed while saving"}}},
            } as never)
            return {workflow_revision: {...base, ...workflow_revision, id: "rev-2"}}
        })
        await store.set(commitAgentCredentialsAtom, {revisionId: "rev-1", bindings})
        expect(store.get(workflowDraftAtomFamily("rev-2"))).toMatchObject({
            data: {
                parameters: {
                    agent: {instructions: "Typed while saving", sandbox: {credentials: bindings}},
                },
            },
        })
    })
})
