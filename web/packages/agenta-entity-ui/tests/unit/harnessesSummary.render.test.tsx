/**
 * The collapsed Harnesses row's value. It is always shown, so the section can stay closed without
 * hiding what it decided, and it separates "nobody chose" from "the user chose none".
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import HarnessesSection, {type HarnessChoice} from "../../src/secretProvider/HarnessesSection"

const CHOICES: HarnessChoice[] = [
    {id: "pi", label: "Pi", supported: true},
    {id: "claude", label: "Claude Code", supported: true},
    {id: "codex", label: "Codex", supported: true},
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const summaryOf = async (selected: string[], unrestricted = false) => {
    await act(async () => {
        root.render(
            createElement(HarnessesSection, {
                choices: CHOICES,
                selected,
                onToggle: () => undefined,
                unrestricted,
            }),
        )
    })
    const button = host.querySelector("button[aria-expanded]")
    return button?.querySelector("[aria-label]")?.getAttribute("aria-label") ?? button?.textContent
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("HarnessesSection summary", () => {
    it("names the one enabled harness", async () => {
        expect(await summaryOf(["pi"])).toBe("enabled in Pi")
    })

    it("lists several harnesses in one line", async () => {
        expect(await summaryOf(["pi", "claude", "codex"])).toBe(
            "enabled in Pi, Claude Code and Codex",
        )
    })

    it("separates 'nobody chose' from 'the user chose none'", async () => {
        expect(await summaryOf([], true)).toContain("· any harness Agenta supports")
        expect(await summaryOf([], false)).toContain("· no harness selected")
    })
})
