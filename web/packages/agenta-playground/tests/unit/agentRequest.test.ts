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
import {describe, expect, it, beforeEach, afterEach, vi} from "vitest"

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
        workflowAgentTemplateOverlayAtomFamily: mk<Record<string, unknown> | null>(null),
        workflowBuildKitEnabledAtomFamily: mk<boolean>(true),
    }
})

import {
    workflowAgentTemplateOverlayAtomFamily,
    workflowBuildKitEnabledAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {projectIdAtom} from "@agenta/shared/state"

import {
    applyBuildKitOverlay,
    buildAgentRequest,
    buildAgentReferences,
} from "../../src/state/execution/agentRequest"
import {agentChannelModeAtomFamily} from "../../src/state/execution/channelMode"
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
        overlay?: Record<string, unknown> | null
        buildKitEnabled?: boolean
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
    store.set(
        workflowAgentTemplateOverlayAtomFamily(id) as PrimitiveAtom<unknown>,
        over.overlay ?? null,
    )
    store.set(
        workflowBuildKitEnabledAtomFamily(id) as PrimitiveAtom<unknown>,
        over.buildKitEnabled ?? true,
    )
}

const authoringSkill = {
    "@ag.embed": {"@ag.references": {workflow: {slug: "__ag__getting_started_with_agenta"}}},
}

const requestConnectionTool = {
    "@ag.embed": {"@ag.references": {workflow: {slug: "__ag__request_connection"}}},
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

    describe("last-message-only (NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY)", () => {
        const u1 = {role: "user", parts: [{type: "text", text: "q1"}]}
        const a1 = {role: "assistant", parts: [{type: "text", text: "a1"}]}
        const u2 = {role: "user", parts: [{type: "text", text: "q2"}]}

        // Runtime override path (getEnv checks globalThis.__env before the build-time snapshot).
        const enableFlag = () => {
            ;(globalThis as any).__env = {NEXT_PUBLIC_SESSIONS_LAST_MESSAGE_ONLY: "true"}
        }
        afterEach(() => {
            delete (globalThis as any).__env
        })

        const outMessages = async (msgs: unknown[], sessionId = "s1") => {
            seed(store, "e", {})
            const req = await buildAgentRequest("e", msgs, {sessionId, store})
            return (req!.requestBody.data as any).inputs.messages
        }

        it("sends only the trailing user message when enabled", async () => {
            enableFlag()
            expect(await outMessages([u1, a1, u2])).toEqual([u2])
        })

        it("sends the full history by default (flag off)", async () => {
            const out = await outMessages([u1, a1, u2])
            expect(out).toEqual([u1, a1, u2])
        })

        it("keeps the full history on a resume (trailing assistant) even when enabled", async () => {
            enableFlag()
            const out = await outMessages([u1, a1])
            expect(out.length).toBeGreaterThan(1)
            expect(out[out.length - 1].role).toBe("assistant")
        })

        it("sends the full history when there is no session id", async () => {
            enableFlag()
            expect(await outMessages([u1, a1, u2], "")).toEqual([u1, a1, u2])
        })
    })

    it("nests messages under data.inputs + draft-aware parameters under data, with session_id", async () => {
        seed(store, "e", {config: {temperature: 0.9, prompt: {x: 1}}})
        const req = await buildAgentRequest("e", [{role: "user"}], {sessionId: "s1", store})
        expect(req).not.toBeNull()
        expect(req!.requestBody.session_id).toBe("s1")
        const data = req!.requestBody.data as any
        expect(data.inputs.messages).toEqual([{role: "user"}])
        // draft-aware config flows through; a bare envelope (no `agent` wrapper) has its execution
        // sections defaulted directly.
        expect(data.parameters).toMatchObject({
            temperature: 0.9,
            prompt: {x: 1},
            harness: {kind: "pi_core"},
        })
    })

    it("defaults the nested execution sections on the template at `parameters.agent`", async () => {
        // The template lives at `parameters.agent`: the definition flat, harness/runner/sandbox
        // nested. The execution sections are defaulted; an explicit value the config carries wins.
        seed(store, "e", {
            config: {agent: {llm: {model: "gpt-5.5"}, sandbox: {kind: "daytona"}}},
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const template = (req!.requestBody.data as any).parameters.agent
        expect(template.llm).toMatchObject({model: "gpt-5.5"})
        expect(template.harness).toEqual({kind: "pi_core"})
        expect(template.sandbox).toEqual({kind: "daytona"})
        expect(template.runner).toMatchObject({permissions: {default: "allow_reads"}})
    })

    it("keeps an explicit permission policy over the runner default", async () => {
        seed(store, "e", {
            config: {agent: {runner: {permissions: {default: "deny"}}}},
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const template = (req!.requestBody.data as any).parameters.agent
        expect(template.runner.permissions.default).toBe("deny")
    })

    it("merges the fallback `default` into a rules-only runner permission override", async () => {
        // A config that supplies only `rules` (no `default`) must still get the fallback
        // `default: "allow_reads"` — the nested `permissions` merge, not a wholesale replace.
        const rules = [{path: "**/*.md", action: "allow"}]
        seed(store, "e", {
            config: {agent: {runner: {permissions: {rules}}}},
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const template = (req!.requestBody.data as any).parameters.agent
        expect(template.runner.permissions).toEqual({default: "allow_reads", rules})
    })

    it("applies the build-kit overlay to a kit-on run with deep and identity merges", async () => {
        const config = {
            agent: {
                sandbox: {kind: "local", permissions: {execute_code: "deny", network: "on"}},
                tools: [
                    {type: "platform", op: "find_capabilities", permission: "ask"},
                    {type: "client", name: "weather"},
                    requestConnectionTool,
                ],
                skills: [authoringSkill],
            },
        }
        const overlay = {
            sandbox: {permissions: {execute_code: "allow", write_files: "allow"}},
            tools: [
                {type: "platform", op: "find_capabilities", permission: "allow"},
                {type: "platform", op: "commit_revision"},
                requestConnectionTool,
            ],
            skills: [authoringSkill],
        }
        const before = JSON.parse(JSON.stringify(config))
        seed(store, "e", {config, overlay, buildKitEnabled: true})

        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const template = (req!.requestBody.data as any).parameters.agent

        expect(template.sandbox).toEqual({
            kind: "local",
            permissions: {execute_code: "allow", network: "on", write_files: "allow"},
        })
        expect(template.tools).toEqual([
            {type: "platform", op: "find_capabilities", permission: "allow"},
            {type: "client", name: "weather"},
            requestConnectionTool,
            {type: "platform", op: "commit_revision"},
        ])
        expect(template.skills).toEqual([authoringSkill])
        expect(config).toEqual(before)
    })

    it("applies the build-kit overlay to a BARE template (no agent wrapper)", async () => {
        // `withAgentRunDefaults` leaves a config with no `agent` key as a bare template, so the
        // overlay must merge at the top level — not no-op (the bare published default case).
        const config = {
            sandbox: {kind: "local", permissions: {execute_code: "deny"}},
            tools: [{type: "client", name: "weather"}],
        }
        seed(store, "e", {
            config,
            overlay: {
                sandbox: {permissions: {execute_code: "allow", write_files: "allow"}},
                tools: [{type: "platform", op: "commit_revision"}],
                skills: [authoringSkill],
            },
            buildKitEnabled: true,
        })

        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const params = (req!.requestBody.data as any).parameters

        // Bare template → overlay applied at the top level, never wrapped under `agent`.
        expect(params.agent).toBeUndefined()
        expect(params.sandbox.permissions).toEqual({
            execute_code: "allow",
            write_files: "allow",
        })
        expect(params.tools).toEqual([
            {type: "client", name: "weather"},
            {type: "platform", op: "commit_revision"},
        ])
        expect(params.skills).toEqual([authoringSkill])
    })

    it("sends the bare agent config unchanged when the build kit is off", async () => {
        const config = {
            agent: {
                sandbox: {kind: "local", permissions: {execute_code: "deny"}},
                tools: [{type: "client", name: "weather"}],
            },
        }
        seed(store, "e", {
            config,
            overlay: {
                sandbox: {permissions: {execute_code: "allow", write_files: "allow"}},
                tools: [{type: "platform", op: "commit_revision"}],
                skills: [authoringSkill],
            },
            buildKitEnabled: false,
        })

        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const template = (req!.requestBody.data as any).parameters.agent

        expect(template.sandbox.permissions).toEqual({execute_code: "deny"})
        expect(template.tools).toEqual([{type: "client", name: "weather"}])
        expect(template.skills).toBeUndefined()
    })

    it("applies the kit only to the run copy, leaving entity parameters bare for commit", async () => {
        // The commit path (web/packages/agenta-entities/src/workflow/state/commit.ts
        // `prepareCommitParameters`) serializes `entity.data.parameters`, which the run never
        // writes. This proves the two stay separate: the throwaway run copy carries the kit while
        // the persisted config the commit reads is untouched.
        const config = {
            agent: {
                sandbox: {kind: "local"},
                tools: [{type: "client", name: "weather"}],
            },
        }
        seed(store, "e", {
            config,
            overlay: {
                sandbox: {permissions: {execute_code: "allow", write_files: "allow"}},
                tools: [{type: "platform", op: "commit_revision"}],
            },
        })

        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})

        // The run copy carries the kit (overlay applied)...
        const runTemplate = (req!.requestBody.data as any).parameters.agent
        expect(runTemplate.tools).toContainEqual({type: "platform", op: "commit_revision"})
        expect(runTemplate.sandbox.permissions).toMatchObject({write_files: "allow"})

        // ...but the persisted config the commit serializer reads is unmutated.
        expect(store.get(workflowMolecule.selectors.configuration("e"))).toEqual(config)
        expect(JSON.stringify(config)).not.toContain("commit_revision")
        expect(JSON.stringify(config)).not.toContain("write_files")
    })

    it("applyBuildKitOverlay never mutates its input template", () => {
        const base = {
            sandbox: {kind: "local", permissions: {execute_code: "deny"}},
            tools: [{type: "platform", op: "find_capabilities", permission: "ask"}],
            skills: [],
        }
        const snapshot = JSON.parse(JSON.stringify(base))

        const result = applyBuildKitOverlay(base, {
            sandbox: {permissions: {execute_code: "allow"}},
            tools: [{type: "platform", op: "find_capabilities", permission: "allow"}],
            skills: [authoringSkill],
        })

        expect(base).toEqual(snapshot)
        expect(result).not.toBe(base)
        expect(result.sandbox).toEqual({
            kind: "local",
            permissions: {execute_code: "allow"},
        })
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

    it("keeps application + application_variant but OMITS application_revision for a DIRTY committed revision", async () => {
        // Unsaved left-panel edits make this an inline-config draft, so the revision reference is
        // withheld (keeps `is_draft` true). The variant identity is orthogonal to draft-ness — a
        // self-targeting tool (e.g. `commit_revision`) still needs it to bind to — so it is
        // forwarded along with the app. references is NOT null.
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
        const refs = req!.requestBody.references as any
        expect(refs).not.toBeNull()
        expect(refs.application.id).toBe(REAL_APP)
        expect(refs.application_variant.id).toBe(REAL_VARIANT)
        expect(refs).not.toHaveProperty("application_revision")
        expect(req!.invocationUrl).toContain(`application_id=${REAL_APP}`)
    })

    it("OMITS references entirely for a truly UNCOMMITTED local draft (no real app/variant/revision ids)", async () => {
        // A brand-new agent that was never saved has no real ids anywhere, so `buildAgentReferences`
        // drops every family and there is no variant to forward — references stays null, unchanged.
        seed(store, "e", {
            data: {
                id: "draft-local-xyz",
                workflow_id: "draft-app-xyz",
                workflow_variant_id: "draft-variant-xyz",
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.requestBody.references).toBeNull()
    })

    it("forwards application + application_variant for a local draft revision id under an already-committed variant", async () => {
        // The revision id is local (never committed), but the app/variant were loaded from a real
        // committed variant. The variant is real, so it is forwarded even though there is no
        // revision reference yet; app scoping also rides the URL query.
        seed(store, "e", {
            data: {id: "draft-local-xyz", workflow_id: REAL_APP, workflow_variant_id: REAL_VARIANT},
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const refs = req!.requestBody.references as any
        expect(refs).not.toBeNull()
        expect(refs.application.id).toBe(REAL_APP)
        expect(refs.application_variant.id).toBe(REAL_VARIANT)
        expect(refs).not.toHaveProperty("application_revision")
        expect(req!.invocationUrl).toContain(`application_id=${REAL_APP}`)
    })

    it("collapses to references: null for a DIRTY run whose only real identity is the revision (no app/variant)", async () => {
        // `buildAgentReferences` would produce ONLY `application_revision` here (a real revision
        // UUID, no real app/variant ids). The gate strips `application_revision` on a dirty run,
        // so nothing survives the gate — references must fall back to null, not an empty object.
        seed(store, "e", {
            isDirty: true,
            data: {id: REAL_REV, version: 3},
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.requestBody.references).toBeNull()
    })

    it("invariant guard: a dirty committed run still carries data.parameters alongside the bare-variant references", async () => {
        // Option 1 depends on the backend never re-resolving a bare variant reference to its HEAD
        // revision. That re-resolution is gated on the request carrying no `data.parameters`
        // (`resolver.py` `needs_reference_hydration`), and a playground run always sends
        // `data.parameters`. Lock that invariant here so a regression is caught in CI.
        seed(store, "e", {
            isDirty: true,
            config: {temperature: 0.9},
            data: {
                id: REAL_REV,
                version: 3,
                workflow_id: REAL_APP,
                workflow_variant_id: REAL_VARIANT,
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const data = req!.requestBody.data as any
        expect(data.parameters).toBeDefined()
        expect(Object.keys(data.parameters).length).toBeGreaterThan(0)
        const refs = req!.requestBody.references as any
        expect(refs.application_variant.id).toBe(REAL_VARIANT)
        expect(refs).not.toHaveProperty("application_revision")
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
        // Negotiation 1 (transport): the per-session channel toggle drives Accept. `batch` asks
        // /invoke for a single WorkflowBatchResponse, which AgentChatTransport replays as one frame.
        store.set(agentChannelModeAtomFamily("s1"), "batch")
        seed(store, "e", {})
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        expect(req!.headers.Accept).toBe("application/json")
        store.set(agentChannelModeAtomFamily("s1"), "stream")
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

    it("drops blank MCP server entries (at parameters.agent.mcps) before sending", async () => {
        seed(store, "e", {
            config: {
                agent: {
                    mcps: [
                        {
                            name: "",
                            connection: {type: "http", url: ""},
                            policy: {tools: {mode: "all"}},
                        },
                        {
                            name: "github",
                            connection: {type: "http", url: "https://mcp.example.com/mcp"},
                            policy: {tools: {mode: "all"}},
                        },
                        {name: "  ", connection: {type: "http", url: ""}},
                    ],
                },
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const template = (req!.requestBody.data as any).parameters.agent
        expect(template.mcps).toHaveLength(1)
        expect(template.mcps[0].name).toBe("github")
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
                agent: {
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
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const template = (req!.requestBody.data as any).parameters.agent
        expect(template.skills).toEqual([
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
                agent: {
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
            },
        })
        const req = await buildAgentRequest("e", [], {sessionId: "s1", store})
        const tools = (req!.requestBody.data as any).parameters.agent.tools
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
