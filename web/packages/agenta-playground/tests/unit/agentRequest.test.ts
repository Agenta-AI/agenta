/**
 * Unit tests for `buildAgentRequest` — the agent lane's request builder.
 *
 * This is the highest-value test in the agent-generation work: it is a
 * regression guard for the three "surprises" the design doc calls out, each of
 * which ships SILENTLY if untested:
 *   1. references DROPPED        → agent traces never surface on the trace page
 *   2. project_id in the BODY    → wrong scoping (must ride the URL query)
 *   3. un-stripped local-draft id → backend 422
 * Plus: draft-aware config merged, and a null result when the entity isn't runnable.
 *
 * The workflow molecule's three read selectors are mocked with writable atoms;
 * headers + project come from the real `executionHeadersAtom` / `projectIdAtom`.
 */
import {createStore, type PrimitiveAtom} from "jotai"
import {describe, expect, it, beforeEach, vi} from "vitest"

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = (await importOriginal()) as any
    const {atom} = await import("jotai")
    const mk = <T>(init: T) => {
        const m = new Map<string, unknown>()
        return (id: string) => {
            if (!m.has(id)) m.set(id, atom<T>(init))
            return m.get(id)
        }
    }
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                invocationUrl: mk<string | null>(null),
                configuration: mk<Record<string, unknown> | null>(null),
                data: mk<Record<string, unknown> | null>(null),
                isDirty: mk<boolean>(false),
            },
        },
    }
})

import {workflowMolecule} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"

import {buildAgentRequest, buildAgentReferences} from "../../src/state/execution/agentRequest"
import {agentChannelModeAtom} from "../../src/state/execution/channelMode"
import {executionHeadersAtom} from "../../src/state/execution/webWorkerIntegration"

const REAL_APP = "11111111-1111-4111-8111-111111111111"
const REAL_VARIANT = "22222222-2222-4222-8222-222222222222"
const REAL_REV = "33333333-3333-4333-8333-333333333333"

const set = (store: any, sel: any, id: string, value: unknown) =>
    store.set(sel(id) as PrimitiveAtom<unknown>, value)

function seed(
    store: ReturnType<typeof createStore>,
    id: string,
    over: {
        url?: string | null
        config?: Record<string, unknown> | null
        data?: any
        isDirty?: boolean
    },
) {
    set(
        store,
        workflowMolecule.selectors.invocationUrl,
        id,
        "url" in over ? over.url : "https://api.test/run",
    )
    set(store, workflowMolecule.selectors.configuration, id, over.config ?? {temperature: 0.7})
    set(store, workflowMolecule.selectors.data, id, over.data ?? null)
    set(store, workflowMolecule.selectors.isDirty, id, over.isDirty ?? false)
}

describe("buildAgentReferences (draft-id stripping)", () => {
    it("returns null for a missing revision", () => {
        expect(buildAgentReferences(null)).toBeNull()
        expect(buildAgentReferences(undefined)).toBeNull()
    })

    it("returns null when nothing identifiable survives the UUID guard", () => {
        // non-UUID ids, no slugs, no version → every block dropped
        expect(
            buildAgentReferences({id: "draft-1", workflow_id: "draft-app", variant_id: "draft-v"}),
        ).toBeNull()
    })

    it("keeps real UUID ids and coerces a numeric version to string", () => {
        const refs = buildAgentReferences({
            id: REAL_REV,
            version: 7,
            workflow_id: REAL_APP,
            workflow_variant_id: REAL_VARIANT,
        })
        expect(refs).toEqual({
            application: {id: REAL_APP},
            application_variant: {id: REAL_VARIANT},
            application_revision: {id: REAL_REV, version: "7"},
        })
    })

    it("falls back to slugs when ids are absent", () => {
        const refs = buildAgentReferences({
            workflow_slug: "my-app",
            workflow_variant_slug: "v-slug",
            slug: "rev-slug",
        })
        expect(refs).toEqual({
            application: {slug: "my-app"},
            application_variant: {slug: "v-slug"},
            application_revision: {slug: "rev-slug"},
        })
    })

    it("drops a draft revision id but keeps its real app id + version", () => {
        const refs = buildAgentReferences({id: "local-draft", version: 2, workflow_id: REAL_APP})
        expect(refs?.application).toEqual({id: REAL_APP})
        expect(refs?.application_revision).toEqual({version: "2"})
        expect((refs?.application_revision as {id?: string})?.id).toBeUndefined()
    })

    it("prefers workflow_* identity over artifact_*/variant_* aliases", () => {
        const refs = buildAgentReferences({
            workflow_id: REAL_APP,
            artifact_id: "22222222-2222-4222-8222-2222222222ff",
            workflow_variant_id: REAL_VARIANT,
            variant_id: "33333333-3333-4333-8333-3333333333ff",
        })
        expect(refs?.application).toEqual({id: REAL_APP})
        expect(refs?.application_variant).toEqual({id: REAL_VARIANT})
    })
})

describe("buildAgentRequest", () => {
    let store: ReturnType<typeof createStore>
    beforeEach(() => {
        store = createStore()
        store.set(projectIdAtom, "proj-123")
        // executionHeadersAtom stores a header FACTORY. Set it the way the app does
        // (updater returns the factory) — a bare function arg is treated as an updater.
        store.set(executionHeadersAtom, () => async () => ({Authorization: "Bearer jwt-abc"}))
    })

    it("returns null when the entity has no invocation URL", async () => {
        seed(store, "e", {url: null})
        expect(await buildAgentRequest("e", [], {sessionId: "s1", store})).toBeNull()
    })

    it("nests messages under data.inputs + draft-aware parameters under data, with session_id", async () => {
        seed(store, "e", {config: {temperature: 0.9, prompt: {x: 1}}})
        const req = await buildAgentRequest("e", [{role: "user"}], {sessionId: "s1", store})
        expect(req).not.toBeNull()
        expect(req!.requestBody.session_id).toBe("s1")
        const data = req!.requestBody.data as any
        expect(data.inputs.messages).toEqual([{role: "user"}])
        // draft-aware config flows through; a flat config (no `agent` key) is defaulted at top level
        expect(data.parameters).toMatchObject({
            temperature: 0.9,
            prompt: {x: 1},
            harness: "pi_core",
        })
    })

    it("defaults harness/sandbox INSIDE the agent block when the config nests under `agent`", async () => {
        // The schema places the run-selection fields on the agent config (`parameters.agent`),
        // not as top-level params siblings. Defaults land there; an explicit value wins.
        seed(store, "e", {config: {agent: {model: "gpt-5.5", sandbox: "daytona"}}})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const agent = (req!.requestBody.data as any).parameters.agent
        expect(agent).toMatchObject({model: "gpt-5.5", harness: "pi_core", sandbox: "daytona"})
        // not duplicated at the top level
        expect((req!.requestBody.data as any).parameters.harness).toBeUndefined()
    })

    it("STRIPS legacy top-level run-selection keys when a nested agent is present", async () => {
        // A partially-migrated config carrying BOTH the nested `agent` and legacy top-level
        // run-selection keys must emit only the nested shape, never both at once.
        seed(store, "e", {
            config: {
                harness: "claude",
                sandbox: "local",
                permission_policy: "deny",
                agent: {model: "gpt-5.5"},
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const parameters = (req!.requestBody.data as any).parameters
        expect(parameters.harness).toBeUndefined()
        expect(parameters.sandbox).toBeUndefined()
        expect(parameters.permission_policy).toBeUndefined()
        expect(parameters.agent).toMatchObject({model: "gpt-5.5", harness: "pi_core"})
    })

    it("INCLUDES references for a CLEAN committed revision run (marks it non-draft)", async () => {
        // A run of an unmodified committed revision claims its identity: the service marks it
        // non-draft from the resolved revision reference and a self-targeting tool binds it.
        seed(store, "e", {
            isDirty: false,
            data: {
                id: REAL_REV,
                version: 3,
                workflow_id: REAL_APP,
                workflow_variant_id: REAL_VARIANT,
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const refs = req!.requestBody.references as any
        expect(refs.application.id).toBe(REAL_APP)
        expect(refs.application_variant.id).toBe(REAL_VARIANT)
        expect(refs.application_revision).toMatchObject({id: REAL_REV, version: "3"})
    })

    it("OMITS references for a DIRTY committed revision (inline-config draft), keeping app scoping", async () => {
        // Unsaved left-panel edits make this an inline-config draft. Forwarding the committed
        // revision would wrongly mark it non-draft and bind a self-targeting tool to a revision
        // whose config differs from what's running, so references are dropped entirely. The app
        // still scopes the run via the URL query.
        seed(store, "e", {
            isDirty: true,
            data: {
                id: REAL_REV,
                version: 3,
                workflow_id: REAL_APP,
                workflow_variant_id: REAL_VARIANT,
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.requestBody.references).toBeNull()
        expect(req!.invocationUrl).toContain(`application_id=${REAL_APP}`)
    })

    it("OMITS references for an UNCOMMITTED local draft (no real revision id), keeping app scoping", async () => {
        // A never-committed local draft has no committed revision UUID, so it is an inline-config
        // draft too — send no references, but keep the app scoping in the URL.
        seed(store, "e", {
            data: {id: "draft-local-xyz", workflow_id: REAL_APP, workflow_variant_id: REAL_VARIANT},
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.requestBody.references).toBeNull()
        expect(req!.invocationUrl).toContain(`application_id=${REAL_APP}`)
    })

    it("puts project_id + application_id in the URL QUERY, never the body", async () => {
        seed(store, "e", {data: {workflow_id: REAL_APP}})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.invocationUrl).toContain(`project_id=proj-123`)
        expect(req!.invocationUrl).toContain(`application_id=${REAL_APP}`)
        // body must NOT carry project_id
        expect(JSON.stringify(req!.requestBody)).not.toContain("proj-123")
        expect(req!.headers.Authorization).toBe("Bearer jwt-abc")
    })

    it("requests the SSE stream via Accept: text/event-stream", async () => {
        seed(store, "e", {})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.headers.Accept).toBe("text/event-stream")
    })

    it("requests batch JSON via Accept when the channel toggle is `batch`", async () => {
        // Negotiation 1 (transport): the channel toggle drives Accept. `batch` asks /invoke
        // for a single WorkflowBatchResponse, which AgentChatTransport replays as one frame.
        store.set(agentChannelModeAtom, "batch")
        seed(store, "e", {})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.headers.Accept).toBe("application/json")
        store.set(agentChannelModeAtom, "stream")
    })

    it("declares the Vercel message format via x-ag-messages-format", async () => {
        seed(store, "e", {})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.headers["x-ag-messages-format"]).toBe("vercel")
    })

    it("omits project_id from the query when unauthenticated", async () => {
        store.set(executionHeadersAtom, () => async () => ({}))
        seed(store, "e", {data: {workflow_id: REAL_APP}})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.invocationUrl).not.toContain("project_id")
    })

    it("drops blank MCP server entries (nested in the agent block) before sending", async () => {
        seed(store, "e", {
            config: {
                agent: {
                    mcp_servers: [
                        {name: "", transport: "stdio", command: "", args: []},
                        {name: "github", transport: "stdio", command: "npx", args: ["-y", "x"]},
                        {name: "  ", transport: "stdio"},
                    ],
                },
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const agent = (req!.requestBody.data as any).parameters.agent
        expect(agent.mcp_servers).toHaveLength(1)
        expect(agent.mcp_servers[0].name).toBe("github")
    })

    it("drops blank MCP server entries at the top level too", async () => {
        seed(store, "e", {
            config: {mcp_servers: [{name: ""}, {name: "ok"}]},
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const params = (req!.requestBody.data as any).parameters
        expect(params.mcp_servers).toEqual([{name: "ok"}])
    })

    it("drops blank inline skill entries but keeps filled ones and @ag.embed refs", async () => {
        const embed = {
            "@ag.embed": {
                "@ag.references": {workflow_revision: {slug: "my-skill", version: "v3"}},
                "@ag.selector": {path: "parameters.skill"},
            },
        }
        seed(store, "e", {
            config: {
                skills: [
                    // freshly added, all-blank → dropped
                    {name: "", description: "", body: ""},
                    // half-filled (no body) → dropped (backend requires body min-length 1)
                    {name: "x", description: "y", body: ""},
                    // fully filled inline → kept
                    {name: "calc", description: "do math", body: "# Calc"},
                    // embed reference (no inline fields) → kept intact
                    embed,
                ],
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const params = (req!.requestBody.data as any).parameters
        expect(params.skills).toEqual([
            {name: "calc", description: "do math", body: "# Calc"},
            embed,
        ])
    })

    it("rewrites a custom function tool to the typed client shape; leaves gateway/typed alone", async () => {
        const gateway = {
            type: "function",
            function: {name: "tools__composio__github__create_issue__default"},
        }
        const builtinTyped = {type: "builtin", name: "web_search"}
        seed(store, "e", {
            config: {
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "get_weather",
                            description: "Get current weather",
                            parameters: {
                                type: "object",
                                properties: {location: {type: "string"}},
                                required: ["location"],
                            },
                        },
                        permission: "ask",
                    },
                    gateway,
                    builtinTyped,
                ],
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const tools = (req!.requestBody.data as any).parameters.tools
        // custom function tool → client config
        expect(tools[0]).toEqual({
            type: "client",
            name: "get_weather",
            description: "Get current weather",
            input_schema: {
                type: "object",
                properties: {location: {type: "string"}},
                required: ["location"],
            },
            permission: "ask",
        })
        // gateway-slug function tool + already-typed tool pass through unchanged
        expect(tools[1]).toEqual(gateway)
        expect(tools[2]).toEqual(builtinTyped)
    })

    it("drops answer-less assistant turns from the sent history (keeps user + real answers)", async () => {
        seed(store, "e", {})
        const msgs = [
            {role: "user", parts: [{type: "text", text: "hi"}]},
            // assistant turn that only thought (no answer) — must be stripped
            {role: "assistant", parts: [{type: "reasoning", text: "hmm"}]},
            {role: "user", parts: [{type: "text", text: "again"}]},
            // empty assistant turn — must be stripped
            {role: "assistant", parts: []},
            // real assistant answer — must be kept
            {role: "assistant", parts: [{type: "text", text: "ok!"}]},
        ]
        const req = await buildAgentRequest("e", msgs, {sessionId: "s1", store})
        const sent = (req!.requestBody.data as any).inputs.messages as any[]
        expect(sent).toHaveLength(3)
        expect(sent.map((m) => m.role)).toEqual(["user", "user", "assistant"])
        expect(sent[2].parts[0].text).toBe("ok!")
    })

    it("targets `/invoke` directly (vercel projection comes from the format header, not the path)", async () => {
        // `/invoke` now serves the v6 UI Message Stream when asked via
        // `Accept: text/event-stream` + `x-ag-messages-format: vercel`; no path rewrite.
        seed(store, "e", {url: "https://api.test/services/agent/v0/invoke"})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.invocationUrl).toContain("/services/agent/v0/invoke")
        expect(req!.invocationUrl).not.toContain("/messages")
    })
})
