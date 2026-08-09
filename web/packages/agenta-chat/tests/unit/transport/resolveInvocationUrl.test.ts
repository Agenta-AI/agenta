import {beforeEach, describe, expect, it, vi} from "vitest"

// The Fern-backed revision fetch and the host config are boundary concerns — stub both so the
// URL rule is tested hermetically (no molecule store, no network).
let revisionResult: {data?: {url?: string | null; uri?: string | null} | null} | null
const retrieveWorkflowRevision = vi.fn(async () => revisionResult)
vi.mock("@agenta/entities/workflow", () => ({
    retrieveWorkflowRevision: (...args: unknown[]) => retrieveWorkflowRevision(...args),
}))
vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "https://host/api",
}))

const {invocationUrlFromRevisionData, resolveInvocationUrl} =
    await import("../../../src/transport/resolveInvocationUrl")

describe("invocationUrlFromRevisionData", () => {
    it("prefers the stored url, trimming trailing slashes", () => {
        expect(invocationUrlFromRevisionData({url: "https://host/services/agent/"})).toBe(
            "https://host/services/agent/invoke",
        )
    })

    it("builds from an agenta uri when there is no url (kind segment stripped)", () => {
        expect(invocationUrlFromRevisionData({uri: "agenta:custom:my-agent:v0"})).toBe(
            "https://host/services/my-agent/v0/invoke",
        )
    })

    it("trims a run of trailing slashes, keeping internal ones", () => {
        expect(invocationUrlFromRevisionData({url: "https://host/services/agent///"})).toBe(
            "https://host/services/agent/invoke",
        )
        expect(invocationUrlFromRevisionData({url: "https://host/services/agent"})).toBe(
            "https://host/services/agent/invoke",
        )
    })

    it("returns null when neither url nor a parsable uri exists", () => {
        expect(invocationUrlFromRevisionData(null)).toBeNull()
        expect(invocationUrlFromRevisionData({uri: "not-agenta"})).toBeNull()
        expect(invocationUrlFromRevisionData({uri: "agenta:only-two"})).toBeNull()
    })

    it("does not fall back to uri when url is present but empty or all slashes", () => {
        expect(
            invocationUrlFromRevisionData({url: "", uri: "agenta:custom:my-agent:v0"}),
        ).toBeNull()
        expect(
            invocationUrlFromRevisionData({url: "///", uri: "agenta:custom:my-agent:v0"}),
        ).toBeNull()
    })

    // CodeQL "polynomial regular expression used on uncontrolled data": the old /\/+$/ backtracked
    // from every start offset on a slash-heavy URL. 200k slashes took ~11s; the scan is ~0.1ms.
    it("stays linear on a url with many slashes", () => {
        const hostile = "https://host" + "/".repeat(200_000) + "x"
        const start = performance.now()
        expect(invocationUrlFromRevisionData({url: hostile})).toBe(`${hostile}/invoke`)
        expect(performance.now() - start).toBeLessThan(250)
    })
})

describe("resolveInvocationUrl", () => {
    beforeEach(() => {
        revisionResult = null
        retrieveWorkflowRevision.mockClear()
    })

    it("passes both refs in ONE fetch (revision id preferred by the backend)", async () => {
        revisionResult = {data: {url: "https://host/services/agent"}}
        const url = await resolveInvocationUrl({
            projectId: "proj-1",
            revisionId: "rev-1",
            workflowId: "wf-1",
        })
        expect(url).toBe("https://host/services/agent/invoke")
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(1)
        expect(retrieveWorkflowRevision).toHaveBeenCalledWith({
            projectId: "proj-1",
            workflowRef: {id: "wf-1"},
            workflowRevisionRef: {id: "rev-1"},
        })
    })

    it("returns null without a fetch when no identifying ref is available", async () => {
        expect(await resolveInvocationUrl({projectId: "proj-1"})).toBeNull()
        expect(retrieveWorkflowRevision).not.toHaveBeenCalled()
    })

    it("returns null when the revision does not resolve", async () => {
        revisionResult = null
        expect(await resolveInvocationUrl({projectId: "proj-1", revisionId: "rev-x"})).toBeNull()
    })
})
