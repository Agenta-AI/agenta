import {describe, expect, it} from "vitest"

import {AGENT_INVOKE_DOCS_URL, agentHostFromApiUrl, agentInvokeBody} from "./request"
import {buildAgentSnippets, type AgentSnippetLang} from "./snippets"

const input = {
    host: "https://eu.cloud.agenta.ai",
    projectId: "proj-1",
    agentId: "agent-1",
    apiKey: "KEY",
}
const LANGS: AgentSnippetLang[] = ["python", "typescript", "bash"]

describe("agent invoke snippets", () => {
    it("offers a streaming and a non-streaming snippet, streaming first", () => {
        for (const lang of LANGS) {
            const snippets = buildAgentSnippets(lang, input)
            expect(snippets.map((snippet) => snippet.key)).toEqual(["stream", "json"])
            expect(snippets[0].code).toMatch(/Accept"?: "?text\/event-stream/)
            expect(snippets[1].code).toMatch(/Accept"?: "?application\/json/)
            expect(snippets[1].code).not.toContain("text/event-stream")
        }
    })

    it("calls the documented endpoint with the API key", () => {
        for (const lang of LANGS) {
            for (const snippet of buildAgentSnippets(lang, input)) {
                expect(snippet.code).toContain(
                    "https://eu.cloud.agenta.ai/services/agent/v0/invoke?project_id=proj-1",
                )
                expect(snippet.code).toContain("ApiKey KEY")
            }
        }
    })

    it("targets the agent's default variant at its latest revision", () => {
        // Only the workflow is referenced: no variant, revision or environment pins it.
        expect(agentInvokeBody("agent-1")).toEqual({
            references: {workflow: {id: "agent-1"}},
            data: {inputs: {messages: [{role: "user", content: "Hello"}]}},
        })
        for (const lang of LANGS) {
            for (const snippet of buildAgentSnippets(lang, input)) {
                expect(snippet.code).toContain('"workflow"')
                expect(snippet.code).toContain('"agent-1"')
                expect(snippet.code).not.toMatch(/workflow_variant|workflow_revision|environment/)
            }
        }
    })

    it("streams in every language", () => {
        const [curl] = buildAgentSnippets("bash", input)
        expect(curl.code).toMatch(/^curl -N -X POST/)
        const [python] = buildAgentSnippets("python", input)
        expect(python.code).toContain("stream=True")
        const [typescript] = buildAgentSnippets("typescript", input)
        expect(typescript.code).toContain("getReader()")
    })

    it("derives the service host from the API URL", () => {
        expect(agentHostFromApiUrl("https://eu.cloud.agenta.ai/api")).toBe(
            "https://eu.cloud.agenta.ai",
        )
        expect(agentHostFromApiUrl("https://eu.cloud.agenta.ai/api/")).toBe(
            "https://eu.cloud.agenta.ai",
        )
        expect(AGENT_INVOKE_DOCS_URL).toBe(
            "https://agenta.ai/docs/reference/agents/invoke-an-agent",
        )
    })
})
