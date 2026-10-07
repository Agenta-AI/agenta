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
const decodeAll = () => decodes.splice(0).forEach((resolve) => resolve())

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
            source: "",
            drawImage(image: HTMLImageElement) {
                ctx.source = image.getAttribute("src") ?? ""
            },
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
        const {ctx} = this as unknown as {ctx: {fillStyle: string; source: string}}
        return `data:image/png;${ctx.source}|${ctx.fillStyle}`
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
    it("badges each icon from its own image and puts the declared href and type back", async () => {
        const declared = icons()
        showTabRunBadge("running")
        decodeAll()
        await settle()
        expect(icons().map(({href, type}) => [href, type])).toEqual([
            ["data:image/png;/m/assets/favicon.ico|blue", "image/png"],
            ["data:image/png;/m/assets/agenta-symbol.svg|blue", "image/png"],
        ])
        showTabRunBadge(null)
        expect(icons()).toEqual(declared)
        expect(icons()[0]).toEqual({href: "/m/assets/favicon.ico", type: null, hasType: false})
    })

    it("drops a draw that lands after the badge was cleared", async () => {
        showTabRunBadge("running")
        showTabRunBadge(null)
        decodeAll()
        await settle()
        expect(icons().map(({href}) => href)).toEqual([
            "/m/assets/favicon.ico",
            "/m/assets/agenta-symbol.svg",
        ])
    })

    it("drops an older draw that lands after a newer badge", async () => {
        showTabRunBadge("running")
        const running = decodes.splice(0)
        showTabRunBadge("completed")
        decodeAll()
        await settle()
        running.forEach((resolve) => resolve())
        await settle()
        expect(icons().map(({href}) => href)).toEqual([
            "data:image/png;/m/assets/favicon.ico|green",
            "data:image/png;/m/assets/agenta-symbol.svg|green",
        ])
    })

    it("draws each icon once per badge and reuses it on the next show", async () => {
        showTabRunBadge("running")
        expect(decodes).toHaveLength(2)
        decodeAll()
        await settle()
        showTabRunBadge(null)
        showTabRunBadge("running")
        await settle()
        expect(decodes).toHaveLength(0)
        expect(icons().map(({href}) => href)).toEqual([
            "data:image/png;/m/assets/favicon.ico|blue",
            "data:image/png;/m/assets/agenta-symbol.svg|blue",
        ])
    })
})
