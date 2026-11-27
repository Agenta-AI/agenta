// @vitest-environment jsdom
//
// The agent's Configuration card names the shared rows, on every harness.
//
// The card had drifted from the shared row list three times over. The MCP row said "N connected",
// claiming an authorized state no summary card can know, where the shared card had been fixed to
// "N configured". The permissions row — the setting that decides whether a run stops to ask — was
// missing here entirely. And the MCP row itself was drawn only on a Claude harness or an agent
// that already had a server, so the one row that says "Connect a server" was absent on exactly
// the agents with none.
//
// The third one survived three review rounds because every case here named one harness, and that
// harness was "claude_code" — not one of the three kinds the API declares, and a value only the
// gate's loose `.includes("claude")` ever accepted. So the suite mounted the one agent the gate did
// not hide the row on. Every case runs over all three kinds and over a revision naming none now,
// which is the whole point: a row list must not depend on the harness.
import {act} from "react"

import {
    AGENT_CONFIG_ROW_KEYS,
    AGENT_CONFIG_ROW_TITLES,
    agentLatestRevisionAtomFamily,
} from "@agenta/entity-ui/agent"
import {createStore, type PrimitiveAtom, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AgentConfigCard} from "@/features/agents/AgentConfigCard"

// Hoisted above the imports by vitest. The revision seam is mocked at the module the package
// barrel re-exports it from.
vi.mock("../../../packages/agenta-entity-ui/src/agent/state", async () => {
    const {atom} = await import("jotai")
    const revision = atom({})
    return {agentLatestRevisionAtomFamily: () => revision}
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

/** The three kinds `HarnessKind` declares, plus the revision that names none. */
const HARNESSES = [
    {label: "pi_core", kind: "pi_core"},
    {label: "claude", kind: "claude"},
    {label: "codex", kind: "codex"},
    {label: "no harness field", kind: undefined},
] as const

type HarnessKind = (typeof HARNESSES)[number]["kind"]

const harnessSection = (kind: HarnessKind) => (kind ? {harness: {kind}} : {})

/** One agent, configured enough that every row has something to state. */
const populated = (kind: HarnessKind) => ({
    llm: {model: "anthropic/claude-opus-5"},
    ...harnessSection(kind),
    instructions: {agents_md: "Answer briefly and cite the source."},
    tools: [{type: "gateway_connection", connection: {integration: "linear"}}],
    mcps: [{slug: "octolens"}, {slug: "axiom"}],
    skills: [{name: "changelog"}],
    runner: {permissions: {default: "allow_reads"}},
})

/**
 * An agent with nothing configured, which is where every divergence was hiding: the card agreed
 * on the fully-populated strings and drifted on all three empty ones.
 */
const bare = (kind: HarnessKind) => harnessSection(kind)

let host: HTMLDivElement
let root: Root

const mount = async (node: React.ReactNode, agent: Record<string, unknown>) => {
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

const mobileCard = (agent: Record<string, unknown>) =>
    mount(<AgentConfigCard agentId="agent" onEdit={() => undefined} />, agent)

describe.each(HARNESSES)("the Configuration card on $label", ({kind}) => {
    it("names every row the shared vocabulary lists", async () => {
        const mobile = await mobileCard(populated(kind))

        for (const key of AGENT_CONFIG_ROW_KEYS) {
            expect(mobile).toContain(MOBILE_TITLES[key])
        }
    })

    it("states the configured count of the agent's MCP servers", async () => {
        const mobile = await mobileCard(populated(kind))

        // "configured", never "connected": the count is of servers on the agent, and whether
        // each is authorized is a live fact the card does not hold.
        expect(mobile).toContain("2 configured")
        expect(mobile).not.toContain("connected")
    })

    it("states the default permission", async () => {
        const mobile = await mobileCard(populated(kind))

        expect(mobile).toContain("Allow reads")
    })

    it("counts the brief in words", async () => {
        // "AGENTS.md · 28w" is an abbreviation the reader has to decode.
        const mobile = await mobileCard(populated(kind))

        expect(mobile).toContain("AGENTS.md · 6 words")
    })
})

describe.each(HARNESSES)("an agent with nothing configured on $label", ({kind}) => {
    it("offers the action on every empty row", async () => {
        // The card's rows open the editor, so an empty row has to offer the verb. The card
        // reported the absence on two of them, beside its own "Add instructions": it said
        // "No integrations" and "No skills".
        const mobile = await mobileCard(bare(kind))

        expect(mobile).toContain("Choose a model")
        expect(mobile).toContain("Add instructions")
        expect(mobile).toContain("Connect a server")
        expect(mobile).toContain("Add skills")
        expect(mobile).not.toContain("No skills")
        expect(mobile).toContain("Add integrations")
        expect(mobile).not.toContain("No integrations")
    })

    it("draws the MCP row with no server on the agent", async () => {
        // The state the gate hid: no MCP server, on a harness the gate did not recognise. The
        // card has to offer the connect verb here, because this is the agent that needs it.
        const mobile = await mobileCard(bare(kind))

        expect(mobile).toContain(AGENT_CONFIG_ROW_TITLES.mcps)
        expect(mobile).toContain("Connect a server")
    })

    it("lists the same rows as a configured agent does", async () => {
        // The row list is what this suite exists for, and it must not depend on how much of the
        // agent is filled in either.
        const mobile = await mobileCard(bare(kind))

        for (const key of AGENT_CONFIG_ROW_KEYS) {
            expect(mobile).toContain(MOBILE_TITLES[key])
        }
    })
})
