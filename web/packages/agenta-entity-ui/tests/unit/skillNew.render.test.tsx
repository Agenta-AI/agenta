/**
 * "Add skills" and "New skill" in the agent: a row click adds or removes the registry reference in
 * the agent configuration; "New skill" opens at depth 2 and a created skill is added to the agent.
 * The Skills section's bin asks first.
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

import {skillsSection} from "../../src/DrillInView/SchemaControls/agentTemplate/sections/SkillsSection"
import {skillAddView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/skillAddView"

import {byText, click, findByText} from "./domHelpers"

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

const embed = (slug: string, name: string) => ({
    name,
    "@ag.embed": {"@ag.references": {workflow: {slug}}},
})
const TRIAGE = embed("ticket-triage-8f2a", "ticket-triage")
const INLINE = {name: "ticket-labels", description: "Labels", body: "# Steps"}

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

const Opener = () => {
    const stack = useViewStack()
    return (
        <button
            onClick={() =>
                void stack.open(skillAddView, {}, {kind: "agent_draft", revisionId: "rev-1"})
            }
        >
            open
        </button>
    )
}

const bridge: Partial<SkillsBridge> = {
    enabled: true,
    AddSkillsBody: ({addedSlugs, onAdd, onRemove, onNewSkill}) =>
        createElement(
            "div",
            null,
            createElement("span", null, `added:${addedSlugs.join(",")}`),
            createElement(
                "button",
                {onClick: () => onAdd(embed("refund-check-7c1d", "refund-check"))},
                "add refund-check",
            ),
            createElement(
                "button",
                {onClick: () => onRemove("ticket-triage-8f2a")},
                "remove ticket-triage",
            ),
            createElement("button", {onClick: onNewSkill}, "new"),
        ),
    NewSkillBody: ({onCreated}) =>
        createElement(
            "button",
            {onClick: () => onCreated([embed("weekly-digest-5e3f", "weekly-digest")])},
            "create weekly-digest",
        ),
}

let root: Root
let host: HTMLDivElement

const render = async (node: React.ReactNode) => {
    await act(async () => root.render(node))
}

const slugs = () =>
    ((writer.agent.skills as Record<string, unknown>[]) ?? []).map((s) => s.name).join(",")

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    writer.agent = {skills: [TRIAGE, INLINE]}
    writer.update = vi.fn((next) => {
        writer.agent = next(writer.agent)
    })
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Add skills", () => {
    const open = async () => {
        await render(
            <DrillInUIProvider components={{skills: bridge as SkillsBridge}}>
                <ViewStackHost chrome={Chrome} rootTitle="Agent">
                    <Opener />
                </ViewStackHost>
            </DrillInUIProvider>,
        )
        await click(byText("open"))
        await findByText("add refund-check")
    }

    it("a click adds the reference at once, and a click on an added row removes it", async () => {
        await open()
        expect(byText("added:ticket-triage-8f2a")).toBeTruthy()
        expect(byText("crumb:Add skills")).toBeTruthy()
        await click(byText("add refund-check"))
        expect(slugs()).toBe("ticket-triage,ticket-labels,refund-check")
        await click(byText("remove ticket-triage"))
        expect(slugs()).toBe("ticket-labels,refund-check")
        // The agent-only skill is never touched by the registry list.
        expect((writer.agent.skills as unknown[])[0]).toBe(INLINE)
    })

    it("does not add the same registry skill twice", async () => {
        writer.agent = {skills: [embed("refund-check-7c1d", "refund-check")]}
        await open()
        await click(byText("add refund-check"))
        expect(slugs()).toBe("refund-check")
    })

    it("New skill opens at depth 2, and a created skill is added to the agent", async () => {
        await open()
        await click(byText("new"))
        await findByText("create weekly-digest")
        await click(byText("create weekly-digest"))
        expect(slugs()).toBe("ticket-triage,ticket-labels,weekly-digest")
    })
})

describe("Skills section remove", () => {
    const renderSection = async (removeItem: (kind: string, index: number) => void) => {
        const section = skillsSection({
            t: ((key: string) => key) as never,
            hasSkills: true,
            fieldTitle: (_f, fallback) => fallback,
            sectionIndicator: () => undefined,
            skills: [TRIAGE, INLINE],
            handleAddSkill: () => undefined,
            openSkillItem: () => undefined,
            removeItem: removeItem as never,
            closeEditor: () => undefined,
            skillStatusFor: () => undefined,
        })
        if (!section) throw new Error("no section")
        await render(<>{section.content}</>)
    }
    it('says "None" when the agent has no skill', () => {
        const section = skillsSection({
            t: ((key: string) => key) as never,
            hasSkills: true,
            fieldTitle: (_f, fallback) => fallback,
            sectionIndicator: () => undefined,
            skills: [],
            handleAddSkill: () => undefined,
            openSkillItem: () => undefined,
            removeItem: () => undefined,
            closeEditor: () => undefined,
            skillStatusFor: () => undefined,
        })
        expect(section && section.summary).toBe("None")
    })
    const bins = () => [...document.querySelectorAll<HTMLElement>('button[aria-label="Remove"]')]

    it("asks first, then removes the skill; the registry text says the skill stays", async () => {
        const removeItem = vi.fn()
        await renderSection(removeItem)
        await click(bins()[0])
        await findByText("The skill stays in your skill registry.")
        expect(removeItem).not.toHaveBeenCalled()
        await click(byText("Remove", "button"))
        expect(removeItem).toHaveBeenCalledWith("skill", 0)
    })

    it("Cancel changes nothing; an agent-only skill says it is deleted", async () => {
        const removeItem = vi.fn()
        await renderSection(removeItem)
        await click(bins()[1])
        await findByText("This skill is only in this agent. Removing it deletes it.")
        await click(byText("Cancel", "button"))
        expect(removeItem).not.toHaveBeenCalled()
    })
})
