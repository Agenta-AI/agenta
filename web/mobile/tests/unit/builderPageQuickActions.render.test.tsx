// @vitest-environment jsdom
/**
 * The quick actions of a new chat on the builder page: three actions and "More ideas", text only.
 * Two put their request in the composer; "Optimize an agent" asks which agent first and names it.
 */
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The picker answers at once with one agent, as a click on its row does.
vi.mock("@/features/builder-page/AgentPicker", () => ({
    AgentPicker: ({
        trigger,
        onPick,
    }: {
        trigger: ReactNode
        onPick: (agent: {id: string; name: string}) => void
    }) => (
        <span data-testid="picker" onClick={() => onPick({id: "agent-1", name: "Support triage"})}>
            {trigger}
        </span>
    ),
}))

import {PageQuickActions} from "@/features/builder-page/PageQuickActions"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
const seen = {filled: [] as string[], picked: [] as string[], ideas: 0}

beforeEach(() => {
    seen.filled = []
    seen.picked = []
    seen.ideas = 0
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() =>
        root.render(
            <PageQuickActions
                onFill={(text) => seen.filled.push(text)}
                onPickAgent={(agent) => seen.picked.push(agent.id)}
                onMoreIdeas={() => (seen.ideas += 1)}
            />,
        ),
    )
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const buttons = () => [...host.querySelectorAll("button")]
const click = (label: string) =>
    act(() =>
        buttons()
            .find((button) => button.textContent === label)
            ?.click(),
    )

describe("PageQuickActions", () => {
    it("shows the three actions and More ideas, in order and with no icon", () => {
        expect(buttons().map((button) => button.textContent)).toEqual([
            "Suggest improvements",
            "Check for problems",
            "Optimize an agent",
            "More ideas",
        ])
        expect(host.querySelector("svg")).toBeNull()
    })

    it("puts the full request of Suggest improvements and Check for problems in the composer", () => {
        click("Suggest improvements")
        click("Check for problems")
        expect(seen.filled[0]).toMatch(/^Look at my agents, their automations/)
        expect(seen.filled[1]).toMatch(/^Check my agents and automations for problems\./)
        expect(seen.picked).toEqual([])
    })

    it("names the picked agent in the Optimize request and sets its chip", () => {
        click("Optimize an agent")
        expect(seen.picked).toEqual(["agent-1"])
        expect(seen.filled).toHaveLength(1)
        expect(seen.filled[0]).toMatch(/^Optimize Support triage\. Write 3 test requests/)
    })

    it("opens the ideas with More ideas", () => {
        click("More ideas")
        expect(seen.ideas).toBe(1)
        expect(seen.filled).toEqual([])
    })
})
