import {describe, expect, it} from "vitest"

import {buildAgentResumeRequest} from "../../../src/transport/agentResumeRequest"

const baseArgs = {
    invocationUrl: "https://host/services/agent/v0/invoke",
    references: {workflow_revision: {id: "rev-1"}},
    sessionId: "session-1",
    messages: [{id: "m1", role: "user", parts: [{type: "text", text: "hi"}]}],
}

describe("buildAgentResumeRequest", () => {
    it("never emits a data.parameters key (references-only server-side hydration)", () => {
        const req = buildAgentResumeRequest(baseArgs)
        expect("parameters" in req.requestBody.data).toBe(false)
        // Belt-and-braces: the serialized wire body must not carry the key either.
        expect(JSON.stringify(req.requestBody)).not.toContain('"parameters"')
    })

    it("carries the session id, references, and messages under data.inputs", () => {
        const req = buildAgentResumeRequest(baseArgs)
        expect(req.requestBody.session_id).toBe("session-1")
        expect(req.requestBody.references).toEqual({workflow_revision: {id: "rev-1"}})
        expect(req.requestBody.data.inputs.messages).toBe(baseArgs.messages)
    })

    it("sends the stream Accept and vercel messages-format headers", () => {
        const req = buildAgentResumeRequest(baseArgs)
        expect(req.headers).toEqual({
            Accept: "text/event-stream",
            "x-ag-messages-format": "vercel",
        })
    })

    it("puts project_id on the query string unconditionally (cookie-auth path)", () => {
        const req = buildAgentResumeRequest({...baseArgs, projectId: "proj-1"})
        expect(req.invocationUrl).toBe("https://host/services/agent/v0/invoke?project_id=proj-1")
    })

    it("appends application_id alongside project_id when provided", () => {
        const req = buildAgentResumeRequest({
            ...baseArgs,
            projectId: "proj-1",
            applicationId: "app-1",
        })
        const url = new URL(req.invocationUrl)
        expect(url.searchParams.get("project_id")).toBe("proj-1")
        expect(url.searchParams.get("application_id")).toBe("app-1")
    })

    it("leaves the URL untouched when no scope params are provided", () => {
        const req = buildAgentResumeRequest(baseArgs)
        expect(req.invocationUrl).toBe(baseArgs.invocationUrl)
    })
})
