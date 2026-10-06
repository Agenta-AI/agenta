// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

type Show = typeof import("@/features/app/faviconBadge").showTabRunBadge

const decodes: (() => void)[] = []
let showTabRunBadge: Show

const icons = () =>
    Array.from(document.querySelectorAll('link[rel~="icon"]')).map((link) => ({
        href: link.getAttribute("href"),
        type: link.getAttribute("type"),
        hasType: link.hasAttribute("type"),
    }))
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
    document.head.innerHTML =
        '<link rel="icon" href="/m/assets/favicon.ico" sizes="any">' +
        '<link rel="icon" href="/m/assets/agenta-symbol.svg" type="image/svg+xml">'
    document.documentElement.style.setProperty("--ag-run-status-processing", "blue")
    document.documentElement.style.setProperty("--ag-run-status-success", "green")
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
        this: HTMLCanvasElement,
    ) {
        const ctx = {
            fillStyle: "",
            drawImage: vi.fn(),
            beginPath: vi.fn(),
            arc: vi.fn(),
            fill: vi.fn(),
        }
        ;(this as unknown as {ctx: typeof ctx}).ctx = ctx
        return ctx as unknown as CanvasRenderingContext2D
    } as never)
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
        this: HTMLCanvasElement,
    ) {
        return `data:image/png;${(this as unknown as {ctx: {fillStyle: string}}).ctx.fillStyle}`
    })
    HTMLImageElement.prototype.decode = () => new Promise<void>((resolve) => decodes.push(resolve))
    decodes.length = 0
    vi.resetModules()
    showTabRunBadge = (await import("@/features/app/faviconBadge")).showTabRunBadge
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe("showTabRunBadge", () => {
    it("swaps every icon to the badge and puts the declared href and type back", async () => {
        const declared = icons()
        showTabRunBadge("running")
        decodes.shift()?.()
        await settle()
        expect(icons().map(({href, type}) => [href, type])).toEqual([
            ["data:image/png;blue", "image/png"],
            ["data:image/png;blue", "image/png"],
        ])
        showTabRunBadge(null)
        expect(icons()).toEqual(declared)
        expect(icons()[0]).toEqual({href: "/m/assets/favicon.ico", type: null, hasType: false})
    })

    it("drops a draw that lands after the badge was cleared", async () => {
        showTabRunBadge("running")
        showTabRunBadge(null)
        decodes.shift()?.()
        await settle()
        expect(icons().map(({href}) => href)).toEqual([
            "/m/assets/favicon.ico",
            "/m/assets/agenta-symbol.svg",
        ])
    })

    it("drops an older draw that lands after a newer badge", async () => {
        showTabRunBadge("running")
        showTabRunBadge("completed")
        decodes[1]()
        await settle()
        decodes[0]()
        await settle()
        expect(icons().map(({href}) => href)).toEqual([
            "data:image/png;green",
            "data:image/png;green",
        ])
    })
})
