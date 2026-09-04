/**
 * Unit tests for the agent commit-diff classifier (accessor + classify + message).
 * Covers the three overlapping `parameters` schema shapes and the change categories.
 */
import {describe, it, expect} from "vitest"

import {readAgentConfig} from "../../src/workflow/commitDiff/accessors"
import {classifyAgentChanges} from "../../src/workflow/commitDiff/classify"
import {parseGatewayToolName} from "../../src/workflow/commitDiff/gatewayName"
import {agentItemIdentity} from "../../src/workflow/commitDiff/identity"
import {buildCommitSummaryMessage} from "../../src/workflow/commitDiff/summaryMessage"

const tool = (
    name: string,
    description = "Search",
    props: Record<string, unknown> = {query: {type: "string"}},
) => ({
    type: "function",
    function: {name, description, parameters: {type: "object", properties: props}},
})

describe("readAgentConfig — three schema shapes normalize to one view", () => {
    const expected = (v: ReturnType<typeof readAgentConfig>) => {
        expect(v.instructions).toBe("You are helpful.")
        expect(v.model).toBe("gpt-4o")
        expect(v.params.temperature).toBe(0.7)
        expect(v.tools).toHaveLength(1)
        expect(v.tools[0].rawKey).toBe("gmail_search")
    }

    it("legacy nested (prompt.llm_config)", () => {
        expected(
            readAgentConfig({
                prompt: {
                    messages: [{role: "system", content: "You are helpful."}],
                    llm_config: {model: "gpt-4o", temperature: 0.7, tools: [tool("gmail_search")]},
                },
            }),
        )
    })

    it("canonical (llms[0])", () => {
        expected(
            readAgentConfig({
                messages: [{role: "system", content: "You are helpful."}],
                llms: [{model: "gpt-4o", temperature: 0.7, tools: [tool("gmail_search")]}],
            }),
        )
    })

    it("flat root", () => {
        expected(
            readAgentConfig({
                messages: [{role: "system", content: "You are helpful."}],
                model: "gpt-4o",
                temperature: 0.7,
                tools: [tool("gmail_search")],
            }),
        )
    })

    it("agent-template shape (parameters.agent.{instructions.agents_md, llm, tools})", () => {
        const v = readAgentConfig({
            agent: {
                kind: "claude",
                instructions: {agents_md: "You are helpful."},
                llm: {model: "gpt-4o", temperature: 0.7},
                tools: [tool("gmail_search")],
            },
        })
        expect(v.instructions).toBe("You are helpful.")
        expect(v.model).toBe("gpt-4o")
        expect(v.params.temperature).toBe(0.7)
        expect(v.tools[0].rawKey).toBe("gmail_search")
    })

    it("handles array (multimodal) message content", () => {
        const v = readAgentConfig({
            messages: [
                {
                    role: "system",
                    content: [
                        {type: "text", text: "hi"},
                        {type: "text", text: "there"},
                    ],
                },
            ],
        })
        expect(v.instructions).toBe("hi\nthere")
    })
})

describe("subagents get their own section, named the way the config panel names them", () => {
    // Regression: named by slug, description dropped, so an edited description showed nothing.
    const ref = (over: Record<string, unknown>) => ({
        type: "reference",
        ref_by: "variant",
        slug: "dev-to-article-writer",
        ...over,
    })

    it("uses the subagent's name, and says what kind of thing it is", () => {
        const sections = classifyAgentChanges(
            {agent: {tools: [ref({name: "Article writer"})]}},
            {agent: {tools: []}},
        )
        // Its own section — never mixed into Tools.
        expect(sections.map((s) => s.id)).toEqual(["subagents"])
        expect(sections[0].items?.[0]).toMatchObject({
            kind: "added",
            label: "Article writer",
            // No detail: "Subagent" would only repeat the section header.
            detail: undefined,
            // The slug stays reachable as the technical key.
            rawKey: "dev-to-article-writer",
        })
    })

    it("falls back to the slug when the reference carries no name", () => {
        const section = classifyAgentChanges(
            {agent: {tools: [ref({})]}},
            {agent: {tools: []}},
        ).find((s) => s.id === "subagents")
        expect(section?.items?.[0]).toMatchObject({label: "dev-to-article-writer"})
    })

    it("keeps real tools and subagents in separate sections", () => {
        const fn = {function: {name: "send_email", parameters: {}}}
        const sections = classifyAgentChanges(
            {agent: {tools: [fn, ref({name: "Writer"})]}},
            {agent: {tools: []}},
        )
        expect(sections.find((s) => s.id === "tools")?.items?.map((i) => i.label)).toEqual([
            "Send email",
        ])
        expect(sections.find((s) => s.id === "subagents")?.items?.map((i) => i.label)).toEqual([
            "Writer",
        ])
    })

    it("counts subagents as subagents in the commit message", () => {
        const sections = classifyAgentChanges(
            {agent: {tools: [ref({name: "Writer"})]}},
            {agent: {tools: []}},
        )
        expect(buildCommitSummaryMessage(sections)).toBe("Added 1 subagent.")
    })

    it("shows WHAT changed when a subagent's description is edited", () => {
        const before = {agent: {tools: [ref({name: "Writer", description: "Writes drafts."})]}}
        const after = {
            agent: {tools: [ref({name: "Writer", description: "Writes and publishes."})]},
        }
        const item = classifyAgentChanges(after, before).find((s) => s.id === "subagents")
            ?.items?.[0]
        expect(item?.kind).toBe("edited")
        expect(item?.descriptionDiff).toEqual({
            before: "Writes drafts.",
            after: "Writes and publishes.",
        })
    })
})

describe("an edited skill shows its prose, the way Instructions does", () => {
    const skill = (over: Record<string, unknown>) => ({
        name: "build-an-agent",
        description: "Builds an agent",
        body: "Step one.\nStep two.",
        ...over,
    })
    const skillsFor = (local: unknown, remote: unknown) =>
        classifyAgentChanges({agent: {skills: [local]}}, {agent: {skills: [remote]}})?.find(
            (s) => s.id === "skills",
        )?.items?.[0]

    it("diffs the body into hunks instead of leaving a bare edited mark", () => {
        const item = skillsFor(skill({body: "Step one.\nStep two, revised."}), skill({}))

        expect(item?.kind).toBe("edited")
        expect(item?.detail).toBe("instructions changed")
        expect(item?.textDiff?.hunks.some((h) => h.type === "added")).toBe(true)
        expect(item?.textDiff?.hunks.some((h) => h.type === "removed")).toBe(true)
    })

    it("names a description-only edit without inventing a body diff", () => {
        const item = skillsFor(skill({description: "Builds agents faster"}), skill({}))

        expect(item?.detail).toBe("description changed")
        expect(item?.textDiff).toBeUndefined()
    })

    it("reports both when the description and the body move together", () => {
        const item = skillsFor(skill({description: "New", body: "Different."}), skill({}))
        expect(item?.detail).toBe("description & instructions changed")
        expect(item?.textDiff).toBeDefined()
    })
})

describe("permission rules read as rules, not as JSON", () => {
    // Regression: the row printed `Harness › permissions › allow  —  ["Bash"]`.
    const row = (local: Record<string, unknown>, remote: Record<string, unknown>) =>
        classifyAgentChanges({agent: local}, {agent: remote})?.find((s) => s.id === "params")
            ?.scalarChanges?.[0]

    it("names the rule lists the way the permissions control does", () => {
        const change = row(
            {harness: {permissions: {allow: ["Bash"]}}},
            {harness: {permissions: {allow: []}}},
        )
        expect(change?.label).toBe("Allow rules")
    })

    it("reads a rule list as prose, and an empty one as None", () => {
        const change = row(
            {harness: {permissions: {deny: ["Bash", "Write"]}}},
            {harness: {permissions: {deny: []}}},
        )
        expect(change?.label).toBe("Deny rules")
        expect(change?.beforeLabel).toBe("None")
        expect(change?.afterLabel).toBe("Bash, Write")
        // The stored value is untouched for consumers that read it back.
        expect(change?.after).toBe('["Bash","Write"]')
    })
})

describe("the tools section is named the way its own playground names it", () => {
    const one = (params: Record<string, unknown>, before: Record<string, unknown>) =>
        classifyAgentChanges(params, before).find((s) => s.id === "tools")

    it("calls them Integrations for an agent template, matching the config panel", () => {
        const section = one(
            {agent: {tools: [{function: {name: "send_email", parameters: {}}}]}},
            {agent: {tools: []}},
        )
        expect(section?.title).toBe("Integrations")
        expect(buildCommitSummaryMessage(section ? [section] : [])).toBe("Added 1 integration.")
    })

    it("keeps them Tools for a prompt variant, which has no integrations", () => {
        const section = one(
            {prompt: {llm_config: {tools: [{type: "web_search"}]}}},
            {prompt: {llm_config: {tools: []}}},
        )
        expect(section?.title).toBe("Tools")
        expect(buildCommitSummaryMessage(section ? [section] : [])).toBe("Added 1 tool.")
    })
})

describe("advanced settings read as settings, not as JSON paths", () => {
    // Regression: the row printed the storage path and the stored enum verbatim.
    const advanced = (params: Record<string, unknown>) =>
        classifyAgentChanges({agent: params}, {agent: {}})?.find((s) => s.id === "params")

    it("names the runner policy and its values the way the config panel does", () => {
        const section = classifyAgentChanges(
            {agent: {runner: {permissions: {default: "allow_reads"}}}},
            {agent: {runner: {permissions: {default: "allow"}}}},
        ).find((s) => s.id === "params")
        const [change] = section?.scalarChanges ?? []
        expect(change.label).toBe("Tool permissions")
        expect(change.beforeLabel).toBe("Allow all")
        expect(change.afterLabel).toBe("Allow reads")
        // Stored values survive for consumers that read them back.
        expect(change.before).toBe("allow")
        expect(change.after).toBe("allow_reads")
        // The storage path survives for the detail/JSON view.
        expect(change.key).toBe("runner.permissions.default")
    })

    it("names generation parameters", () => {
        const [change] = advanced({temperature: 0.7})?.scalarChanges ?? []
        expect(change.label).toBe("Temperature")
    })

    it("reads booleans as On/Off", () => {
        const [change] = advanced({stream: true})?.scalarChanges ?? []
        expect(change.label).toBe("Streaming")
        expect(change.afterLabel).toBe("On")
    })

    it("humanizes an unmapped key instead of dropping it", () => {
        const [change] = advanced({sandbox: {network_access: "none"}})?.scalarChanges ?? []
        expect(change.label).toBe("Sandbox › network access")
        expect(change.afterLabel).toBe("none")
    })
})

describe("gateway tools are named by what they DO, not by their discriminator", () => {
    // Regression: no `function.name`, so every gateway tool rendered as its discriminator.
    const config = (tools: unknown[]) => readAgentConfig({agent: {tools}})

    it("names a canonical gateway action, and drops the integration prefix", () => {
        const [t] = config([
            {
                type: "gateway",
                provider: "composio",
                integration: "gmail",
                action: "GMAIL_ADD_LABEL",
                connection: "b81",
            },
        ]).tools
        expect(t.label).toBe("Add label")
        expect(t.source).toBe("Gmail")
        // The technical key stays reachable for the detail view.
        expect(t.rawKey).toBe("GMAIL_ADD_LABEL")
    })

    it("names an integration entry after the app it connects", () => {
        const [t] = config([
            {
                type: "gateway_connection",
                connection: {provider: "composio", integration: "gmail", slug: "gmail-work"},
            },
        ]).tools
        expect(t.label).toBe("Gmail")
        expect(t.source).toBe("Integration")
    })

    it("gives the legacy slug encoding the same name as the canonical one", () => {
        const [legacy] = config([
            {function: {name: "tools__composio__gmail__GMAIL_ADD_LABEL__b81"}},
        ]).tools
        expect(legacy.label).toBe("Add label")
        expect(legacy.source).toBe("Gmail")
    })

    it("reports which tool changed, not just that a tool changed", () => {
        const before = {
            agent: {
                tools: [
                    {
                        type: "gateway",
                        integration: "gmail",
                        action: "GMAIL_ADD_LABEL",
                        connection: "b81",
                    },
                ],
            },
        }
        const after = {
            agent: {
                tools: [
                    {
                        type: "gateway",
                        integration: "gmail",
                        action: "GMAIL_SEND_EMAIL",
                        connection: "b81",
                    },
                ],
            },
        }
        const tools = classifyAgentChanges(after, before).find((s) => s.id === "tools")
        expect(tools?.items?.map((i) => i.label).sort()).toEqual(["Add label", "Send email"])
    })
})

describe("classifyAgentChanges", () => {
    const base = {
        prompt: {
            messages: [{role: "system", content: "You are a helpful assistant."}],
            llm_config: {model: "gpt-4o", temperature: 0.7, tools: [tool("gmail_search")]},
        },
    }

    it("no-op returns []", () => {
        expect(classifyAgentChanges(base, base)).toEqual([])
    })

    it("added tool", () => {
        const local = {
            prompt: {
                ...base.prompt,
                llm_config: {
                    ...base.prompt.llm_config,
                    tools: [tool("gmail_search"), tool("gmail_send")],
                },
            },
        }
        const sections = classifyAgentChanges(local, base)
        const tools = sections.find((s) => s.id === "tools")
        expect(tools?.totalCount).toBe(1)
        expect(tools?.items?.[0]).toMatchObject({kind: "added", rawKey: "gmail_send"})
    })

    it("removed tool", () => {
        const local = {prompt: {...base.prompt, llm_config: {...base.prompt.llm_config, tools: []}}}
        const tools = classifyAgentChanges(local, base).find((s) => s.id === "tools")
        expect(tools?.items?.[0]).toMatchObject({kind: "removed", rawKey: "gmail_search"})
    })

    it("edited tool captures field-level changes", () => {
        const local = {
            prompt: {
                ...base.prompt,
                llm_config: {
                    ...base.prompt.llm_config,
                    tools: [
                        tool("gmail_search", "Search and return IDs", {
                            query: {type: "string"},
                            max_results: {type: "number"},
                        }),
                    ],
                },
            },
        }
        const tools = classifyAgentChanges(local, base).find((s) => s.id === "tools")
        const item = tools?.items?.[0]
        expect(item?.kind).toBe("edited")
        expect(item?.fieldChanges?.some((f) => f.field === "description")).toBe(true)
        expect(
            item?.fieldChanges?.some((f) => f.field === "max_results" && f.kind === "added"),
        ).toBe(true)
    })

    it("agent-template: workflow-reference tools are diffed, not dropped", () => {
        // The agent flow adds reference tools (`type:"reference"`, no `function.name`) via
        // "Reference a workflow"; normalizeTool used to drop them → invisible in the Tools diff.
        const remote = {agent: {tools: []}}
        const local = {agent: {tools: [{type: "reference", slug: "sub-workflow"}]}}
        const section = classifyAgentChanges(local, remote).find((s) => s.id === "subagents")
        expect(section?.tags).toContainEqual({kind: "added", label: "1 added"})
        expect(section?.items?.[0]).toMatchObject({
            kind: "added",
            label: "sub-workflow",
            rawKey: "sub-workflow",
        })
    })

    it("agent-template: editing a reference tool (no function fields) still registers", () => {
        const remote = {agent: {tools: [{type: "reference", slug: "wf", version: "1"}]}}
        const local = {agent: {tools: [{type: "reference", slug: "wf", version: "2"}]}}
        const section = classifyAgentChanges(local, remote).find((s) => s.id === "subagents")
        expect(section?.items?.[0]).toMatchObject({kind: "edited", rawKey: "wf"})
    })

    it("classifier: nameless builtin tools are diffed too (prompt playground / legacy)", () => {
        // Builtins aren't offered in the agent tool picker, but the prompt playground reuses this
        // classifier and does have them — they must not be dropped, added or removed.
        const remote = {prompt: {llm_config: {tools: [{type: "web_search"}]}}}
        const local = {prompt: {llm_config: {tools: []}}}
        const removed = classifyAgentChanges(local, remote).find((s) => s.id === "tools")
        expect(removed?.items?.[0]).toMatchObject({kind: "removed", label: "Web search"})

        const added = classifyAgentChanges(remote, local).find((s) => s.id === "tools")
        expect(added?.items?.[0]).toMatchObject({kind: "added", label: "Web search"})
    })

    it("flat legacy function tool ({name,...}, no wrapper) keeps fn identity + field diffs", () => {
        const remote = {prompt: {llm_config: {tools: [{name: "lookup", description: "old"}]}}}
        const local = {prompt: {llm_config: {tools: [{name: "lookup", description: "new"}]}}}
        const tools = classifyAgentChanges(local, remote).find((s) => s.id === "tools")
        const item = tools?.items?.[0]
        expect(item).toMatchObject({kind: "edited", rawKey: "lookup"})
        expect(item?.fieldChanges?.some((f) => f.field === "description")).toBe(true)
    })

    it("instructions rewrite", () => {
        const local = {
            prompt: {
                ...base.prompt,
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful email assistant.\nAlways confirm.",
                    },
                ],
            },
        }
        const instr = classifyAgentChanges(local, base).find((s) => s.id === "instructions")
        expect(instr).toBeTruthy()
        expect(instr?.textDiff?.added).toBeGreaterThan(0)
    })

    it("agent-template: instructions change is detected", () => {
        const remote = {agent: {instructions: {agents_md: "You are a hello-world agent."}}}
        const local = {
            agent: {instructions: {agents_md: "You are a hello-world agent.\n\nAdd a test."}},
        }
        const instr = classifyAgentChanges(local, remote).find((s) => s.id === "instructions")
        expect(instr?.textDiff?.added).toBeGreaterThan(0)
    })

    it("model swap", () => {
        const local = {
            prompt: {
                ...base.prompt,
                llm_config: {...base.prompt.llm_config, model: "claude-opus-4-8"},
            },
        }
        const model = classifyAgentChanges(local, base).find((s) => s.id === "model")
        expect(model?.scalarChanges?.[0]).toMatchObject({
            before: "gpt-4o",
            after: "claude-opus-4-8",
        })
    })

    it("advanced param change", () => {
        const local = {
            prompt: {...base.prompt, llm_config: {...base.prompt.llm_config, temperature: 0.2}},
        }
        const params = classifyAgentChanges(local, base).find((s) => s.id === "params")
        expect(params?.scalarChanges?.[0]).toMatchObject({
            key: "temperature",
            before: "0.7",
            after: "0.2",
        })
    })

    it("agent-template: harness (non-kind) change lands in Advanced with a prefixed path", () => {
        const remote = {agent: {harness: {kind: "pi_core", max_iterations: 10}}}
        const local = {agent: {harness: {kind: "pi_core", max_iterations: 25}}}
        const advanced = classifyAgentChanges(local, remote).find((s) => s.id === "params")
        expect(advanced?.title).toBe("Advanced")
        expect(advanced?.scalarChanges).toContainEqual({
            key: "harness.max_iterations",
            label: "Max iterations",
            before: "10",
            after: "25",
            beforeLabel: "10",
            afterLabel: "25",
            kind: "changed",
        })
    })

    it("agent-template: nested harness permission leaf uses a dot path in Advanced", () => {
        const remote = {agent: {harness: {kind: "pi_core", permissions: {web_search: false}}}}
        const local = {agent: {harness: {kind: "pi_core", permissions: {web_search: true}}}}
        const advanced = classifyAgentChanges(local, remote).find((s) => s.id === "params")
        expect(advanced?.scalarChanges).toContainEqual({
            key: "harness.permissions.web_search",
            label: "Web search",
            before: "false",
            after: "true",
            beforeLabel: "Off",
            afterLabel: "On",
            kind: "changed",
        })
    })

    it("agent-template: llm connection-mode change lands in Model, not Advanced", () => {
        // Connection-mode selection lives in the Model drawer now, so its diff must
        // classify there — not in Advanced (which would show it under the wrong section).
        const remote = {
            agent: {llm: {model: "opus", provider: "anthropic", connection: {mode: "agenta"}}},
        }
        const local = {
            agent: {
                llm: {model: "opus", provider: "anthropic", connection: {mode: "self_managed"}},
            },
        }
        const sections = classifyAgentChanges(local, remote)
        // No params changed → no Advanced section.
        expect(sections.find((s) => s.id === "params")).toBeUndefined()
        const modelHarness = sections.find((s) => s.id === "model")
        expect(modelHarness?.title).toBe("Model")
        expect(modelHarness?.scalarChanges).toContainEqual({
            key: "llm.connection.mode",
            label: "Connection mode",
            before: "agenta",
            after: "self_managed",
            beforeLabel: "agenta",
            afterLabel: "self_managed",
            kind: "changed",
        })
    })

    it("agent-template: a model-only change stays in Model (no Advanced leak)", () => {
        const remote = {agent: {llm: {model: "opus", provider: "anthropic"}}}
        const local = {agent: {llm: {model: "opus[1m]", provider: "anthropic"}}}
        const sections = classifyAgentChanges(local, remote)
        expect(sections.find((s) => s.id === "params")).toBeUndefined()
        const mh = sections.find((s) => s.id === "model")
        expect(mh?.scalarChanges).toContainEqual({
            key: "llm.model",
            label: "Model",
            before: "opus",
            after: "opus[1m]",
            beforeLabel: "opus",
            afterLabel: "opus[1m]",
            kind: "changed",
        })
    })

    it("agent-template: runner + sandbox changes land in Advanced", () => {
        const remote = {agent: {runner: {kind: "sidecar"}, sandbox: {kind: "local"}}}
        const local = {agent: {runner: {kind: "e2b"}, sandbox: {kind: "remote"}}}
        const advanced = classifyAgentChanges(local, remote).find((s) => s.id === "params")
        expect(advanced?.scalarChanges?.map((c) => c.key)).toEqual(["runner.kind", "sandbox.kind"])
    })

    it("agent-template: harness kind change lands in Model", () => {
        const remote = {agent: {harness: {kind: "pi_core"}, llm: {model: "gpt-4o"}}}
        const local = {agent: {harness: {kind: "claude"}, llm: {model: "gpt-4o"}}}
        const sections = classifyAgentChanges(local, remote)
        const mh = sections.find((s) => s.id === "model")
        expect(mh?.title).toBe("Model")
        expect(mh?.scalarChanges).toContainEqual({
            key: "harness.kind",
            label: "Harness",
            before: "pi_core",
            after: "claude",
            beforeLabel: "pi_core",
            afterLabel: "claude",
            kind: "changed",
        })
        // model + harness are one section, never split into two accordions.
        expect(sections.filter((s) => s.id === "model")).toHaveLength(1)
    })

    it("agent-template: mcp servers list diff", () => {
        const remote = {agent: {mcps: [{name: "github"}]}}
        const local = {agent: {mcps: [{name: "github"}, {name: "linear"}]}}
        const mcps = classifyAgentChanges(local, remote).find((s) => s.id === "mcps")
        expect(mcps?.title).toBe("MCPs")
        expect(mcps?.items?.[0]).toMatchObject({kind: "added", label: "linear"})
    })

    it("agent-template: unchanged harness yields no Advanced section", () => {
        const cfg = {agent: {harness: {kind: "pi_core"}, llm: {model: "gpt-4o"}}}
        const local = {agent: {...cfg.agent, llm: {model: "claude-opus-4-8"}}}
        const sections = classifyAgentChanges(local, cfg)
        expect(sections.find((s) => s.id === "params")).toBeUndefined()
        expect(sections.find((s) => s.id === "model")).toBeTruthy()
    })
})

describe("agentItemIdentity — collision-free item identity", () => {
    it("keys tools by reference slug / function name / positional fallback", () => {
        expect(agentItemIdentity("tool", {type: "reference", slug: "wf-a"}, 0)).toBe("ref:wf-a")
        expect(agentItemIdentity("tool", {function: {name: "gmail_send"}}, 0)).toBe("fn:gmail_send")
        expect(agentItemIdentity("tool", {type: "platform", op: "list"}, 0)).toBe("platform:list")
        // Bare builtin (only a type) has no stable id → positional, so duplicates never collapse.
        expect(agentItemIdentity("tool", {type: "web_search"}, 2)).toBe("#2")
    })

    it("keys the flat legacy function shape {name,...} by fn:<name>", () => {
        expect(agentItemIdentity("tool", {name: "get_weather", parameters: {}}, 0)).toBe(
            "fn:get_weather",
        )
        expect(agentItemIdentity("tool", {type: "function", name: "get_weather"}, 0)).toBe(
            "fn:get_weather",
        )
    })

    it("gives two id-less tools distinct identities (no map collapse)", () => {
        const a = agentItemIdentity("tool", {type: "web_search"}, 0)
        const b = agentItemIdentity("tool", {type: "code_execution"}, 1)
        expect(a).not.toBe(b)
    })

    it("keys mcps by name and skills by embed slug / name", () => {
        expect(agentItemIdentity("mcp", {name: "github"}, 0)).toBe("mcp:github")
        expect(
            agentItemIdentity(
                "skill",
                {"@ag.embed": {"@ag.references": {workflow: {slug: "sk-1"}}}},
                0,
            ),
        ).toBe("skill:sk-1")
        expect(agentItemIdentity("skill", {name: "writer"}, 0)).toBe("skill:writer")
    })
})

describe("classifyAgentChanges — list identity is collision-free", () => {
    it("does not collapse two id-less mcp entries onto one key", () => {
        const remote = {agent: {mcps: [{}]}}
        const local = {agent: {mcps: [{}, {}]}}
        const mcps = classifyAgentChanges(local, remote).find((s) => s.id === "mcps")
        // Positional identity: #0 unchanged, #1 added — the second entry is not silently dropped.
        expect(mcps?.totalCount).toBe(1)
        expect(mcps?.tags).toContainEqual({kind: "added", label: "1 added"})
    })
})

describe("parseGatewayToolName", () => {
    it("humanizes a gateway function name", () => {
        expect(parseGatewayToolName("tools__composio__gmail__ADD_LABEL_TO_EMAIL__b81")).toEqual({
            label: "Add label to email",
            source: "Gmail",
        })
    })
    it("humanizes the generic {source}__ACTION short form", () => {
        expect(parseGatewayToolName("gmail__FETCH_EMAILS")).toEqual({
            label: "Fetch emails",
            source: "Gmail",
        })
    })
    it("humanizes a plain function name", () => {
        expect(parseGatewayToolName("gmail_search_emails")).toEqual({label: "Gmail search emails"})
    })
})

describe("buildCommitSummaryMessage", () => {
    it("composes a sentence from sections", () => {
        const base = {
            prompt: {
                messages: [{role: "system", content: "a"}],
                llm_config: {model: "gpt-4o", tools: []},
            },
        }
        const local = {
            prompt: {
                messages: [{role: "system", content: "a much longer set of instructions here"}],
                llm_config: {model: "claude-opus-4-8", tools: [tool("gmail_send")]},
            },
        }
        // Ordered to mirror the config panel: Model, Instructions, …, Tools.
        const msg = buildCommitSummaryMessage(classifyAgentChanges(local, base))
        expect(msg).toBe(
            "Changed the model to claude-opus-4-8, edited the instructions, and added 1 tool.",
        )
    })
})
