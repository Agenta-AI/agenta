/**
 * The skill view of an agent: a skill is found by its key; Save writes the agent-only skill into
 * the agent configuration (auto-save then saves the version); Publish swaps it for the registry
 * reference and the view still finds it; a registry skill renders the bridge's body; a skill that
 * left the agent shows the removed state.
 */
import {act, createElement} from "react"

import {DrillInUIProvider, type SkillsBridge} from "@agenta/ui/drill-in"
import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    findSkillByKey,
    skillItemRef,
    skillView,
} from "../../src/DrillInView/SchemaControls/agentTemplate/views/skillView"

import {byText, change, click, findByText, waitFor} from "./domHelpers"

const {writer} = vi.hoisted(() => ({
    writer: {
        agent: {} as Record<string, unknown>,
        schema: null,
        revisionId: "rev-1",
        readOnly: false,
        update: null as unknown as (
            next: (agent: Record<string, unknown>) => Record<string, unknown>,
        ) => void,
    },
}))

vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter", () => ({
    useAgentConfigWriter: () => writer,
}))
vi.mock("../../src/DrillInView/SchemaControls/MarkdownEditor", () => ({
    MarkdownEditor: () => createElement("div"),
}))
vi.mock("../../src/DrillInView/SchemaControls/CodeEditor", () => ({
    CodeEditor: () => createElement("div"),
    codeLanguageFromPath: () => "code",
}))

const TRIAGE = {name: "ticket-triage", description: "Triage tickets", body: "# Steps"}
const EMBED = {
    name: "ticket-triage",
    "@ag.embed": {"@ag.references": {workflow: {slug: "ticket-triage-4k2p"}}},
}

const Chrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        <nav>
            {crumbs.map((crumb, i) => (
                <span key={i}>{`crumb:${crumb.title}`}</span>
            ))}
        </nav>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const Opener = ({skillKey}: {skillKey: string}) => {
    const stack = useViewStack()
    return (
        <button
            onClick={() =>
                void stack.open(
                    skillView,
                    {item: {list: "skills", key: skillKey}},
                    {kind: "agent_draft", revisionId: "rev-1"},
                )
            }
        >
            open
        </button>
    )
}

let root: Root
let host: HTMLDivElement

const openSkill = async (skillKey: string, bridge?: Partial<SkillsBridge>) => {
    await act(async () =>
        root.render(
            <DrillInUIProvider components={bridge ? {skills: bridge as SkillsBridge} : {}}>
                <ViewStackHost chrome={Chrome} rootTitle="Agent">
                    <Opener skillKey={skillKey} />
                </ViewStackHost>
            </DrillInUIProvider>,
        ),
    )
    await click(byText("open"))
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    writer.agent = {skills: [{name: "plain-writing", description: "d", body: "b"}, TRIAGE]}
    writer.update = vi.fn((next) => {
        writer.agent = next(writer.agent)
    })
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("skill keys", () => {
    it("an agent-only skill is keyed by its name, a registry skill by its embed slug", () => {
        expect(skillItemRef(TRIAGE)).toEqual({list: "skills", key: "ticket-triage"})
        expect(skillItemRef(EMBED)).toEqual({list: "skills", key: "ticket-triage-4k2p"})
        expect(skillItemRef({description: "no name"})).toBeNull()
    })

    it("finds the published skill by its name after Publish swapped it for a reference", () => {
        expect(findSkillByKey([EMBED], "ticket-triage")).toBe(EMBED)
        expect(findSkillByKey([EMBED], "ticket-triage-4k2p")).toBe(EMBED)
        expect(findSkillByKey([TRIAGE], "other")).toBeUndefined()
    })
})

describe("agent-only skill", () => {
    it("Save writes this skill into the agent configuration and leaves the others", async () => {
        await openSkill("ticket-triage")
        await findByText("Only available to this agent")
        expect(byText("crumb:ticket-triage")).toBeTruthy()
        const description = (await findByText(
            "",
            'textarea[placeholder="When the agent should reach for this skill"]',
        )) as HTMLTextAreaElement
        await change(description, "Triage every new ticket")
        await click(byText("Save"))
        expect(writer.update).toHaveBeenCalledTimes(1)
        expect(writer.agent.skills).toEqual([
            {name: "plain-writing", description: "d", body: "b"},
            {...TRIAGE, description: "Triage every new ticket"},
        ])
        await waitFor(() => expect(byText("Only available to this agent")).toBeUndefined())
    })

    it("Publish swaps the skill for the registry reference in place", async () => {
        const publishInlineSkill = vi.fn(async () => ({entry: EMBED}))
        const RegistrySkillBody = ({params}: {params: {slug: string}}) =>
            createElement("span", null, `registry:${params.slug}`)
        await openSkill("ticket-triage", {publishInlineSkill, RegistrySkillBody})
        await click(await findByText("", 'button[aria-label="Skill actions"]'))
        await click(await findByText("Publish to skill registry"))
        expect(publishInlineSkill).toHaveBeenCalledWith(TRIAGE)
        expect((writer.agent.skills as unknown[])[1]).toBe(EMBED)
        await findByText("registry:ticket-triage-4k2p")
    })
})

describe("registry skill and removed skill", () => {
    it("a registry skill renders the bridge's registry body with its slug", async () => {
        writer.agent = {skills: [EMBED]}
        const RegistrySkillBody = ({params}: {params: {slug: string}}) =>
            createElement("span", null, `registry:${params.slug}`)
        await openSkill("ticket-triage-4k2p", {RegistrySkillBody})
        await findByText("registry:ticket-triage-4k2p")
    })

    it("a skill that left the agent shows the removed state, never another skill", async () => {
        writer.agent = {skills: [{name: "plain-writing", description: "d", body: "b"}]}
        await openSkill("ticket-triage")
        await findByText("This skill is no longer in the agent.")
        expect(byText("plain-writing")).toBeUndefined()
    })
})
