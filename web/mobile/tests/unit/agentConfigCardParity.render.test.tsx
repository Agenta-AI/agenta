// @vitest-environment jsdom
//
// The agent's Configuration card says the same things on both apps.
//
// The two cards are not one component and should not be: the desktop one renders the playground
// panel's accordion sections, and this app's renders the overview rail's own shell, which its two
// sibling cards share so the three read as one column rather than three framed panels. What must
// not differ is WHICH rows there are and what each is called.
//
// It had differed, twice over. The MCP row said "N connected", claiming an authorized state no
// summary card can know, where the shared card had been fixed to "N configured". And the
// permissions row — the setting that decides whether a run stops to ask — was missing here
// entirely. Both halves are the same failure: a forked list of rows with nothing holding the two
// lists together. The vocabulary lives in `@agenta/entity-ui/agent` now and this renders both
// cards against one revision to prove they read it.
import {act} from "react"

import {
    AGENT_CONFIG_ROW_KEYS,
    AGENT_CONFIG_ROW_TITLES,
    AgentConfigSummaryCard,
    agentLatestRevisionAtomFamily,
} from "@agenta/entity-ui/agent"
import {createStore, type PrimitiveAtom, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentConfigCard} from "@/features/agents/AgentConfigCard"

// Hoisted above the imports by vitest. The revision seam is mocked at the module both cards read
// it from, not at the package barrel: the desktop card imports `./state` directly, so a barrel
// mock leaves it on the real atom and it renders its pending skeleton forever.
vi.mock("../../../packages/agenta-entity-ui/src/agent/state", async () => {
    const {atom} = await import("jotai")
    const revision = atom({})
    return {agentLatestRevisionAtomFamily: () => revision}
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

/**
 * One agent, configured enough that every row has something to state. The harness is Claude
 * because this app hides the MCP row on a harness that ignores the setting.
 */
const AGENT = {
    llm: {model: "anthropic/claude-opus-5"},
    harness: {kind: "claude_code"},
    instructions: {agents_md: "Answer briefly and cite the source."},
    tools: [{type: "gateway_connection", connection: {integration: "linear"}}],
    mcps: [{slug: "octolens"}, {slug: "axiom"}],
    skills: [{name: "changelog"}],
    runner: {permissions: {default: "allow_reads"}},
}

let host: HTMLDivElement
let root: Root

const mount = async (node: React.ReactNode, agent: Record<string, unknown> = AGENT) => {
    const store = createStore()
    store.set(agentLatestRevisionAtomFamily("agent") as unknown as PrimitiveAtom<unknown>, {
        data: {data: {parameters: {agent}}},
        isPending: false,
        isError: false,
        refetch: () => undefined,
    })
    await act(async () => root.render(<Provider store={store}>{node}</Provider>))
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

/** The one row whose noun each host declares for itself; this app calls tools Integrations. */
const MOBILE_TITLES = {...AGENT_CONFIG_ROW_TITLES, tools: "Integrations"}

/** A fresh mount per render: two cards in one host would match each other's text. */
const remount = async () => {
    await act(async () => root.unmount())
    host.remove()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
}

/**
 * An agent with nothing configured, which is where every divergence was hiding: the cards agreed
 * on the fully-populated strings and disagreed on all three empty ones. The Claude harness keeps
 * the MCP row drawn, since this app hides it on a harness that ignores the setting.
 */
const EMPTY_AGENT = {harness: {kind: "claude_code"}}

describe("the agent Configuration card, on both apps", () => {
    it("names every row the shared vocabulary lists", async () => {
        const shown = await mount(<AgentConfigCard agentId="agent" onEdit={() => undefined} />)

        for (const key of AGENT_CONFIG_ROW_KEYS) {
            expect(shown).toContain(MOBILE_TITLES[key])
        }
    })

    it("names them on the desktop card too, from the same source", async () => {
        const shown = await mount(<AgentConfigSummaryCard appId="agent" onEdit={() => undefined} />)

        for (const key of AGENT_CONFIG_ROW_KEYS) {
            expect(shown).toContain(AGENT_CONFIG_ROW_TITLES[key])
        }
    })

    it("states the same thing about the agent's MCP servers", async () => {
        const mobile = await mount(<AgentConfigCard agentId="agent" onEdit={() => undefined} />)
        await act(async () => root.unmount())
        host.remove()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        const desktop = await mount(
            <AgentConfigSummaryCard appId="agent" onEdit={() => undefined} />,
        )

        // "configured", never "connected": the count is of servers on the agent, and whether
        // each is authorized is a live fact neither card holds.
        expect(mobile).toContain("2 configured")
        expect(desktop).toContain("2 configured")
        expect(mobile).not.toContain("connected")
        expect(desktop).not.toContain("connected")
    })

    it("states the same default permission", async () => {
        const mobile = await mount(<AgentConfigCard agentId="agent" onEdit={() => undefined} />)
        await act(async () => root.unmount())
        host.remove()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        const desktop = await mount(
            <AgentConfigSummaryCard appId="agent" onEdit={() => undefined} />,
        )

        expect(mobile).toContain("Allow reads")
        expect(desktop).toContain("Allow reads")
    })
})

describe("an agent with nothing configured, on both apps", () => {
    it("offers the action on every empty row, on both cards", async () => {
        // Both cards' rows open the editor, so an empty row has to offer the verb. The mobile
        // card reported the absence on two of them, beside its own "Add instructions": it said
        // "No integrations" and "No skills" where the desktop card says "Add tools" and
        // "Add skills". The noun differs by host; the verb must not.
        const mobile = await mount(
            <AgentConfigCard agentId="agent" onEdit={() => undefined} />,
            EMPTY_AGENT,
        )
        await remount()
        const desktop = await mount(
            <AgentConfigSummaryCard appId="agent" onEdit={() => undefined} />,
            EMPTY_AGENT,
        )

        for (const shown of [mobile, desktop]) {
            expect(shown).toContain("Choose a model")
            expect(shown).toContain("Add instructions")
            expect(shown).toContain("Connect a server")
            expect(shown).toContain("Add skills")
            expect(shown).not.toContain("No skills")
        }
        // The one row whose noun each host names for itself, both offering the same verb.
        expect(mobile).toContain("Add integrations")
        expect(desktop).toContain("Add tools")
        expect(mobile).not.toContain("No integrations")
    })

    it("counts the brief the same way once there is one", async () => {
        // "AGENTS.md · 28w" against "AGENTS.md · 28 words" is the same fact in two strings, and
        // an abbreviation the reader has to decode.
        const mobile = await mount(<AgentConfigCard agentId="agent" onEdit={() => undefined} />)
        await remount()
        const desktop = await mount(
            <AgentConfigSummaryCard appId="agent" onEdit={() => undefined} />,
        )

        expect(mobile).toContain("AGENTS.md · 6 words")
        expect(desktop).toContain("AGENTS.md · 6 words")
    })
})
