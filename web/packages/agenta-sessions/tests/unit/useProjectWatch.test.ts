import {beforeEach, describe, expect, it, vi} from "vitest"

const invalidateSessionListQueries = vi.fn()
const invalidateWorkflowsListCache = vi.fn()
const invalidateAgentCommittedRevisionCache = vi.fn()
vi.mock("@agenta/entities/session", () => ({invalidateSessionListQueries}))
vi.mock("@agenta/entities/workflow", () => ({
    invalidateWorkflowsListCache,
    invalidateAgentCommittedRevisionCache,
}))
vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "http://api.test",
    getHostQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

const {projectWatchHandlers} = await import("../../src/watch/useProjectWatch")

const event = (name: string, data = "") => new MessageEvent<string>(name, {data})

describe("projectWatchHandlers", () => {
    beforeEach(() => vi.clearAllMocks())

    // A workflow change is, as often as not, a new revision: without this the per-agent
    // latest-revision caches kept answering with the id the commit replaced.
    it("a workflow change re-reads the latest-revision caches, not only the lists", () => {
        projectWatchHandlers["workflow-changed"](event("workflow-changed"))

        expect(invalidateWorkflowsListCache).toHaveBeenCalledTimes(1)
        expect(invalidateAgentCommittedRevisionCache.mock.calls).toEqual([[undefined]])
        expect(invalidateSessionListQueries).not.toHaveBeenCalled()
    })

    it("a change that names its workflow re-reads only that workflow's revision", () => {
        projectWatchHandlers["workflow-changed"](
            event("workflow-changed", '{"entity":"workflow","id":"wf-A"}'),
        )

        expect(invalidateWorkflowsListCache).toHaveBeenCalledTimes(1)
        expect(invalidateAgentCommittedRevisionCache.mock.calls).toEqual([["wf-A"]])
    })

    it("a session change leaves the workflow caches alone", () => {
        projectWatchHandlers["session-changed"](event("session-changed"))

        expect(invalidateSessionListQueries).toHaveBeenCalledTimes(1)
        expect(invalidateAgentCommittedRevisionCache).not.toHaveBeenCalled()
    })

    it("a reconnect refreshes everything, since anything may have moved while it was down", () => {
        projectWatchHandlers.ready(event("ready"))

        expect(invalidateSessionListQueries).toHaveBeenCalledTimes(1)
        expect(invalidateWorkflowsListCache).toHaveBeenCalledTimes(1)
        expect(invalidateAgentCommittedRevisionCache.mock.calls).toEqual([[undefined]])
    })
})
