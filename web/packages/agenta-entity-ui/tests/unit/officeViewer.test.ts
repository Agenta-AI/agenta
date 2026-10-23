import {afterEach, describe, expect, it, vi} from "vitest"

import {mediaViewerKind} from "../../src/drive/MediaViewer"
import {sanitizeLinks} from "../../src/drive/officeViewer/frame/runtime"
import {
    buildViewerSrcdoc,
    isOpenableLink,
    OFFICE_VIEWER_CSP,
    OFFICE_VIEWER_SANDBOX,
    openViewerLink,
    parseHostMessage,
    parseViewerMessage,
} from "../../src/drive/officeViewer/protocol"

afterEach(() => vi.restoreAllMocks())

describe("parseViewerMessage", () => {
    it("accepts the five frame messages", () => {
        expect(parseViewerMessage({type: "ready"})).toEqual({type: "ready"})
        expect(parseViewerMessage({type: "failed", extra: 1})).toEqual({type: "failed"})
        expect(parseViewerMessage({type: "rendered", slideCount: 3})).toEqual({
            type: "rendered",
            slideCount: 3,
        })
        expect(parseViewerMessage({type: "slide", index: 2})).toEqual({type: "slide", index: 2})
        expect(parseViewerMessage({type: "open-link", url: "https://agenta.ai/docs"})).toEqual({
            type: "open-link",
            url: "https://agenta.ai/docs",
        })
    })

    it.each([
        null,
        "ready",
        [{type: "ready"}],
        {type: "eval", code: "alert(1)"},
        {type: "rendered"},
        {type: "rendered", slideCount: -1},
        {type: "rendered", slideCount: 1.5},
        {type: "slide", index: "2"},
        {type: "open-link"},
        {type: "open-link", url: "javascript:alert(1)"},
        {type: "open-link", url: "data:text/html,<script>alert(1)</script>"},
    ])("rejects %j", (data) => {
        expect(parseViewerMessage(data)).toBeNull()
    })
})

describe("parseHostMessage", () => {
    it("accepts render with an ArrayBuffer and goto with an index", () => {
        const bytes = new ArrayBuffer(4)
        expect(parseHostMessage({type: "render", kind: "document", bytes})).toEqual({
            type: "render",
            kind: "document",
            bytes,
        })
        expect(parseHostMessage({type: "goto", index: 0})).toEqual({type: "goto", index: 0})
    })

    it("rejects render without bytes or with an unknown kind", () => {
        expect(parseHostMessage({type: "render", kind: "document", bytes: "PK"})).toBeNull()
        expect(
            parseHostMessage({type: "render", kind: "spreadsheet", bytes: new ArrayBuffer(1)}),
        ).toBeNull()
        expect(parseHostMessage({type: "goto", index: -1})).toBeNull()
    })
})

describe("links", () => {
    it.each([
        ["https://example.com/a?b=1", true],
        ["http://example.com", true],
        ["mailto:team@agenta.ai", true],
        ["javascript:alert(1)", false],
        ["JAVASCRIPT:alert(1)", false],
        ["data:text/html,hi", false],
        ["blob:null/1234", false],
        ["file:///etc/passwd", false],
        ["/relative/path", false],
        ["#heading", false],
    ])("%s openable: %s", (url, openable) => {
        expect(isOpenableLink(url)).toBe(openable)
    })

    it("opens allowed links in a new tab without an opener, and nothing else", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null)
        expect(openViewerLink("https://example.com")).toBe(true)
        expect(openViewerLink("javascript:alert(1)")).toBe(false)
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer")
    })

    it("turns script links into plain text and keeps safe ones", () => {
        const root = document.createElement("div")
        root.innerHTML =
            '<a href="javascript:alert(1)" target="_top">bad</a>' +
            '<a href="https://example.com" target="_blank">good</a>' +
            '<a href="#toc">anchor</a>'
        sanitizeLinks(root)
        const [bad, good, anchor] = Array.from(root.querySelectorAll("a"))
        expect(bad.hasAttribute("href")).toBe(false)
        expect(bad.textContent).toBe("bad")
        expect(good.getAttribute("href")).toBe("https://example.com")
        expect(good.hasAttribute("target")).toBe(false)
        expect(anchor.getAttribute("href")).toBe("#toc")
    })
})

describe("buildViewerSrcdoc", () => {
    const srcdoc = buildViewerSrcdoc('console.log("</script><script>alert(1)</script>")')

    it("carries the D6 policy and a script-only sandbox", () => {
        expect(OFFICE_VIEWER_SANDBOX).toBe("allow-scripts")
        expect(OFFICE_VIEWER_CSP).toBe(
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
                "img-src data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; " +
                "object-src 'none'; form-action 'none'",
        )
        expect(srcdoc).toContain(
            `<meta http-equiv="Content-Security-Policy" content="${OFFICE_VIEWER_CSP}">`,
        )
        expect(srcdoc).toContain('"allow-scripts"')
    })

    it("keeps the viewer document inside one script element of the relay", () => {
        expect(srcdoc.match(/<\/script>/g)).toHaveLength(1)
        expect(srcdoc.endsWith("</script></body></html>")).toBe(true)
        const start = srcdoc.indexOf('"\\u003c!doctype')
        const end = srcdoc.lastIndexOf(', "allow-scripts")')
        const viewerDoc = JSON.parse(srcdoc.slice(start, end)) as string
        expect(viewerDoc).toContain(OFFICE_VIEWER_CSP)
        expect(viewerDoc.match(/<\/script>/g)).toHaveLength(1)
        expect(viewerDoc).toContain("<\\/script><script>alert(1)<\\/script>")
    })
})

describe("mediaViewerKind", () => {
    it.each([
        ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"],
        ["application/vnd.ms-excel", "spreadsheet"],
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
        [
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "presentation",
        ],
        ["application/msword", "other"],
    ])("an attachment typed %s opens as %s", (mediaType, kind) => {
        expect(mediaViewerKind({name: "attachment", mediaType})).toBe(kind)
    })

    it("resolves budget.xlsx by its name", () => {
        expect(mediaViewerKind({name: "budget.xlsx"})).toBe("spreadsheet")
    })
})
