import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

import type {Workflow} from "../../src/workflow/core"
import {
    agentIconAtomFamily,
    readAgentIconTag,
    withAgentIconTag,
} from "../../src/workflow/state/agentIcon"
import {toWorkflowListRef, type WorkflowListRef} from "../../src/workflow/state/store"

const {queryWorkflows, updateWorkflow} = vi.hoisted(() => ({
    queryWorkflows: vi.fn(),
    updateWorkflow: vi.fn(),
}))

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api")>()
    return {...actual, queryWorkflows, updateWorkflow}
})

const PROJECT_ID = "proj-1"
const LIST_KEY = ["workflows", "apps", "list", PROJECT_ID]
const robot = {name: "robot", color: "#113955"}
const brain = {name: "brain", color: "#AA0000"}

describe("readAgentIconTag", () => {
    it("reads a well-formed icon", () => {
        expect(readAgentIconTag({"@ag": {icon: robot}})).toEqual(robot)
    })

    it("is null when there is no icon", () => {
        expect(readAgentIconTag(null)).toBeNull()
        expect(readAgentIconTag(undefined)).toBeNull()
        expect(readAgentIconTag({})).toBeNull()
        expect(readAgentIconTag({"@ag": {}})).toBeNull()
        expect(readAgentIconTag({"@ag": "yes"})).toBeNull()
    })

    it("rejects a malformed icon rather than half-reading it", () => {
        expect(readAgentIconTag({"@ag": {icon: {name: "", color: "#113955"}}})).toBeNull()
        expect(readAgentIconTag({"@ag": {icon: {name: 7, color: "#113955"}}})).toBeNull()
        expect(readAgentIconTag({"@ag": {icon: {name: "robot", color: "blue"}}})).toBeNull()
        expect(readAgentIconTag({"@ag": {icon: {name: "robot"}}})).toBeNull()
        expect(readAgentIconTag({"@ag": {icon: "robot"}})).toBeNull()
    })
})

describe("withAgentIconTag", () => {
    it("adds the icon to an empty map", () => {
        expect(withAgentIconTag(null, robot)).toEqual({"@ag": {icon: robot}})
    })

    it("keeps unrelated tags, outside and inside @ag", () => {
        const tags = {team: "growth", "@ag": {icon: robot, source: "import"}}
        expect(withAgentIconTag(tags, brain)).toEqual({
            team: "growth",
            "@ag": {icon: brain, source: "import"},
        })
    })

    it("removes the icon for null and drops an emptied @ag", () => {
        expect(withAgentIconTag({team: "growth", "@ag": {icon: robot}}, null)).toEqual({
            team: "growth",
        })
        expect(withAgentIconTag({"@ag": {icon: robot, source: "import"}}, null)).toEqual({
            "@ag": {source: "import"},
        })
        // `{}`, not null: the edit endpoint drops a null field and would keep the old tags.
        expect(withAgentIconTag({"@ag": {icon: robot}}, null)).toEqual({})
    })

    it("does not mutate its input", () => {
        const tags = {"@ag": {icon: robot}}
        withAgentIconTag(tags, brain)
        expect(tags).toEqual({"@ag": {icon: robot}})
    })
})

describe("agentIconAtomFamily", () => {
    const workflow = (id: string, tags: Workflow["tags"] = null): Workflow =>
        ({id, name: id, slug: id, flags: {}, tags}) as Workflow

    const makeStore = (refs: WorkflowListRef[]) => {
        const queryClient = new QueryClient()
        const store = createStore()
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, PROJECT_ID)
        store.set(sessionAtom, true)
        queryClient.setQueryData(LIST_KEY, {count: refs.length, refs})
        return {store, queryClient}
    }

    const readIcon = async (store: ReturnType<typeof createStore>, id: string) => {
        // Subscribed, as a hook would be: only a mounted query atom follows later cache writes.
        store.sub(agentIconAtomFamily(id), () => undefined)
        // The glyph map resolves on a microtask; a second read sees it.
        store.get(agentIconAtomFamily(id))
        await new Promise((resolve) => setTimeout(resolve, 0))
        return store.get(agentIconAtomFamily(id))
    }

    beforeEach(() => {
        queryWorkflows.mockReset()
        updateWorkflow.mockReset()
        vi.mocked(message.error).mockReset()
    })

    it("reads the icon from the apps list and resolves its glyph from the catalog", async () => {
        const {store} = makeStore([toWorkflowListRef(workflow("wf-1", {"@ag": {icon: robot}}))])

        expect(await readIcon(store, "wf-1")).toEqual({
            icon: "robot",
            color: "#113955",
            path: "<path d='M1 1'/>",
        })
    })

    it("falls back to the default glyph, not an error, when the catalog fails to load", async () => {
        const catalog = await import("@agenta/ui/agent-icon")
        const spy = vi.spyOn(catalog, "loadAgentIconCatalog").mockRejectedValue(new Error("404"))
        try {
            const {store} = makeStore([toWorkflowListRef(workflow("wf-1", {"@ag": {icon: robot}}))])
            expect(await readIcon(store, "wf-1")).toBeNull()
        } finally {
            spy.mockRestore()
        }
    })

    it("fills the glyph map on the next pick after a failed catalog load", async () => {
        const catalog = await import("@agenta/ui/agent-icon")
        const spy = vi
            .spyOn(catalog, "loadAgentIconCatalog")
            .mockRejectedValueOnce(new Error("404"))
        try {
            const {store} = makeStore([toWorkflowListRef(workflow("wf-1", {"@ag": {icon: robot}}))])
            expect(await readIcon(store, "wf-1")).toBeNull()

            queryWorkflows.mockResolvedValue({count: 1, workflows: [workflow("wf-1")]})
            updateWorkflow.mockResolvedValue(undefined)
            await store.set(agentIconAtomFamily("wf-1"), {
                icon: "brain",
                color: "#AA0000",
                path: "",
            })

            expect((await readIcon(store, "wf-1"))?.path).toBe("<path d='M2 2'/>")
        } finally {
            spy.mockRestore()
        }
    })

    it("refuses to save when the artifact is not returned, so no other tag is wiped", async () => {
        const {store} = makeStore([toWorkflowListRef(workflow("wf-1", {"@ag": {icon: robot}}))])
        queryWorkflows.mockResolvedValue({count: 0, workflows: []})

        await store.set(agentIconAtomFamily("wf-1"), {icon: "brain", color: "#AA0000", path: ""})

        expect(updateWorkflow).not.toHaveBeenCalled()
        expect((await readIcon(store, "wf-1"))?.icon).toBe("robot")
        expect(message.error).toHaveBeenCalledTimes(1)
    })

    it("is null for an agent without an icon, and for a name the catalog lacks", async () => {
        const {store} = makeStore([
            toWorkflowListRef(workflow("plain")),
            toWorkflowListRef(workflow("gone", {"@ag": {icon: {name: "nope", color: "#000000"}}})),
        ])

        expect(await readIcon(store, "plain")).toBeNull()
        expect(await readIcon(store, "gone")).toBeNull()
    })

    it("shows the pick at once, merges it into the latest tags, and sends no SVG", async () => {
        const {store} = makeStore([toWorkflowListRef(workflow("wf-1", {team: "growth"}))])
        let release!: () => void
        queryWorkflows.mockResolvedValue({
            count: 1,
            workflows: [workflow("wf-1", {team: "growth", "@ag": {source: "import"}})],
        })
        updateWorkflow.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve
                }),
        )

        const write = store.set(agentIconAtomFamily("wf-1"), {
            icon: "brain",
            color: "#AA0000",
            path: "<path d='M2 2'/>",
        })
        expect((await readIcon(store, "wf-1"))?.icon).toBe("brain")

        await vi.waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1))
        expect(updateWorkflow).toHaveBeenCalledWith(PROJECT_ID, {
            id: "wf-1",
            tags: {team: "growth", "@ag": {source: "import", icon: brain}},
        })
        release()
        await write

        expect((await readIcon(store, "wf-1"))?.icon).toBe("brain")
        expect(message.error).not.toHaveBeenCalled()
    })

    it("restores the previous icon and says so when the save fails", async () => {
        const {store} = makeStore([toWorkflowListRef(workflow("wf-1", {"@ag": {icon: robot}}))])
        queryWorkflows.mockResolvedValue({
            count: 1,
            workflows: [workflow("wf-1", {"@ag": {icon: robot}})],
        })
        updateWorkflow.mockRejectedValue(new Error("503"))

        await store.set(agentIconAtomFamily("wf-1"), {
            icon: "brain",
            color: "#AA0000",
            path: "<path d='M2 2'/>",
        })

        expect((await readIcon(store, "wf-1"))?.icon).toBe("robot")
        expect(message.error).toHaveBeenCalledTimes(1)
    })

    it("clears the icon with null, leaving the other tags in place", async () => {
        const {store} = makeStore([
            toWorkflowListRef(workflow("wf-1", {team: "growth", "@ag": {icon: robot}})),
        ])
        queryWorkflows.mockResolvedValue({
            count: 1,
            workflows: [workflow("wf-1", {team: "growth", "@ag": {icon: robot}})],
        })
        updateWorkflow.mockResolvedValue(undefined)

        await store.set(agentIconAtomFamily("wf-1"), null)

        expect(updateWorkflow).toHaveBeenCalledWith(PROJECT_ID, {
            id: "wf-1",
            tags: {team: "growth"},
        })
        expect(await readIcon(store, "wf-1")).toBeNull()
    })

    it("sends two quick picks one after the other, the second after the first has landed", async () => {
        const {store} = makeStore([toWorkflowListRef(workflow("wf-1"))])
        let releaseFirst!: () => void
        queryWorkflows.mockResolvedValue({count: 1, workflows: [workflow("wf-1")]})
        updateWorkflow
            .mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        releaseFirst = resolve
                    }),
            )
            .mockResolvedValueOnce(undefined)

        const first = store.set(agentIconAtomFamily("wf-1"), {
            icon: "robot",
            color: "#113955",
            path: "",
        })
        const second = store.set(agentIconAtomFamily("wf-1"), {
            icon: "brain",
            color: "#AA0000",
            path: "",
        })
        await vi.waitFor(() => expect(updateWorkflow).toHaveBeenCalledTimes(1))
        expect(queryWorkflows).toHaveBeenCalledTimes(1)

        releaseFirst()
        await Promise.all([first, second])

        expect(updateWorkflow).toHaveBeenCalledTimes(2)
        expect(updateWorkflow.mock.calls[1][1].tags).toEqual({"@ag": {icon: brain}})
        expect((await readIcon(store, "wf-1"))?.icon).toBe("brain")
    })

    it("a failed save does not hold up the next one", async () => {
        const {store} = makeStore([toWorkflowListRef(workflow("wf-1"))])
        queryWorkflows.mockResolvedValue({count: 1, workflows: [workflow("wf-1")]})
        updateWorkflow.mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(undefined)

        await store.set(agentIconAtomFamily("wf-1"), {icon: "robot", color: "#113955", path: ""})
        await store.set(agentIconAtomFamily("wf-1"), {icon: "brain", color: "#AA0000", path: ""})

        expect(updateWorkflow).toHaveBeenCalledTimes(2)
        expect((await readIcon(store, "wf-1"))?.icon).toBe("brain")
    })

    it("does nothing without a workflow id or a project", async () => {
        const {store} = makeStore([])
        await store.set(agentIconAtomFamily(""), {icon: "brain", color: "#AA0000", path: ""})
        store.set(projectIdAtom, null)
        await store.set(agentIconAtomFamily("wf-1"), {icon: "brain", color: "#AA0000", path: ""})

        expect(queryWorkflows).not.toHaveBeenCalled()
        expect(updateWorkflow).not.toHaveBeenCalled()
    })
})
