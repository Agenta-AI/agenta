// @vitest-environment jsdom
/**
 * The Configuration page lists the sections the configuration renders, in their order, and a
 * click scrolls to the section and marks it.
 */
import {act, useRef} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ConfigurationSectionNav} from "@/features/agent-pages/ConfigurationSectionNav"
import {isConfigurationTab} from "@/features/agent-pages/configurationTabs"

const Page = ({sections}: {sections: {key: string; title?: string}[]}) => {
    const ref = useRef<HTMLDivElement>(null)
    return (
        <>
            <ConfigurationSectionNav contentRef={ref} />
            <div ref={ref} data-testid="content">
                {sections.map((s) => (
                    <div
                        key={s.key}
                        data-config-section={s.key}
                        data-config-section-title={s.title}
                    >
                        {s.key}
                    </div>
                ))}
            </div>
        </>
    )
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const buttons = () => [
    ...host.querySelectorAll<HTMLButtonElement>('[data-testid="configuration-section-nav"] button'),
]

describe("ConfigurationSectionNav", () => {
    it("lists the sections with a title, in order", () => {
        act(() =>
            root.render(
                <Page
                    sections={[
                        {key: "model-harness", title: "Model"},
                        {key: "instructions", title: "Instructions"},
                        {key: "untitled"},
                        {key: "advanced", title: "Advanced"},
                    ]}
                />,
            ),
        )
        expect(buttons().map((b) => b.textContent)).toEqual(["Model", "Instructions", "Advanced"])
        // One section is marked as the one in view (jsdom has no layout to tell which).
        expect(buttons().filter((b) => b.getAttribute("aria-current") === "location")).toHaveLength(
            1,
        )
    })

    it("scrolls to a section on click and marks it", () => {
        act(() =>
            root.render(
                <Page
                    sections={[
                        {key: "model-harness", title: "Model"},
                        {key: "skills", title: "Skills"},
                    ]}
                />,
            ),
        )
        const content = host.querySelector<HTMLElement>('[data-testid="content"]')!
        const scrollTo = vi.fn()
        content.scrollTo = scrollTo as unknown as typeof content.scrollTo
        act(() => buttons()[1].click())
        expect(scrollTo).toHaveBeenCalledTimes(1)
        expect(buttons()[1].getAttribute("aria-current")).toBe("location")
    })

    it("follows sections that arrive later", async () => {
        act(() => root.render(<Page sections={[]} />))
        expect(buttons()).toEqual([])
        await act(async () => root.render(<Page sections={[{key: "skills", title: "Skills"}]} />))
        expect(buttons().map((b) => b.textContent)).toEqual(["Skills"])
    })
})

describe("isConfigurationTab", () => {
    it("knows the three tabs and nothing else", () => {
        expect(["agent", "automations", "access"].every(isConfigurationTab)).toBe(true)
        expect(isConfigurationTab("channels")).toBe(false)
        expect(isConfigurationTab(undefined)).toBe(false)
    })
})
