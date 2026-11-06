// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {SdkEvaluationSheet} from "@/features/evaluations/new/SdkEvaluationSheet"

const keys = vi.hoisted(() => ({createApiKey: vi.fn()}))

vi.mock("@agenta/settings", () => ({createApiKey: keys.createApiKey}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

const mount = async (open = true) => {
    await act(async () =>
        root.render(
            createElement(SdkEvaluationSheet, {
                open,
                workspaceId: "ws",
                projectId: "pr",
                onClose: vi.fn(),
            }),
        ),
    )
}

const button = (label: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        label.test(b.textContent ?? ""),
    )

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    keys.createApiKey.mockReset()
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("SDK evaluation sheet", () => {
    it("Shows the install command, the script and the colab and docs links", async () => {
        await mount()
        const text = document.body.textContent ?? ""
        expect(text).toContain("Evaluate from SDK")
        expect(text).toContain("pip install -U agenta")
        expect(text).toContain("aevaluate")
        const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"))
        expect(hrefs).toContain("https://agenta.ai/docs/evaluation/evaluation-from-sdk/quick-start")
        expect(hrefs.some((href) => href?.startsWith("https://colab.research.google.com/"))).toBe(
            true,
        )
    })

    it("Generate API Key creates a key for the workspace and project and shows it", async () => {
        keys.createApiKey.mockResolvedValue("key-123")
        await mount()
        await act(async () => button(/Generate API Key/)?.click())
        expect(keys.createApiKey).toHaveBeenCalledWith("ws", "pr")
        expect(document.querySelector<HTMLInputElement>("#sdk-evaluation-api-key")?.value).toBe(
            "key-123",
        )
    })
})
