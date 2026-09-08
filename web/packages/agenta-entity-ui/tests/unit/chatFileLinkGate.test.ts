/**
 * The rule that decides which link targets reach a host's anchor component.
 *
 * `rehype-harden` (the last plugin in Streamdown's rehype pipeline) parses a relative href only
 * when it starts with `/`, `./` or `../`, and drops the anchor otherwise. The platform prompt tells
 * the agent to write the bare working-directory-relative form, so every file link it wrote was
 * dropped (#6659). These cases pin the respelling that gets that form through, and pin the shapes
 * it must NOT touch — a scheme URL keeps its own path through the gate, where harden decides it.
 */
import {describe, expect, it} from "vitest"

import {
    decodeDriveHref,
    explicitRelativeHref,
    isExternalHref,
    rehypeExplicitRelativeLinks,
} from "../../src/drive/chatFileLinkGate"

describe("explicitRelativeHref", () => {
    it("respells the working-directory-relative path the platform prompt prescribes", () => {
        expect(explicitRelativeHref("agent-files/report.md")).toBe("./agent-files/report.md")
    })

    it("respells a bare filename", () => {
        expect(explicitRelativeHref("report.md")).toBe("./report.md")
    })

    it("leaves a path harden already parses alone", () => {
        expect(explicitRelativeHref("/tmp/agenta/report.md")).toBeNull()
        expect(explicitRelativeHref("./agent-files/report.md")).toBeNull()
        expect(explicitRelativeHref("../report.md")).toBeNull()
    })

    it("leaves every non-path target to the gate", () => {
        expect(explicitRelativeHref("https://example.com/a")).toBeNull()
        expect(explicitRelativeHref("mailto:qa@agenta.ai")).toBeNull()
        expect(explicitRelativeHref("javascript:alert(1)")).toBeNull()
        expect(explicitRelativeHref("file:///tmp/report.md")).toBeNull()
        expect(explicitRelativeHref("//example.com/a")).toBeNull()
        expect(explicitRelativeHref("#section")).toBeNull()
        expect(explicitRelativeHref("")).toBeNull()
    })
})

describe("isExternalHref", () => {
    it("is true for a scheme URL, a protocol-relative host, and a fragment", () => {
        expect(isExternalHref("https://example.com")).toBe(true)
        expect(isExternalHref("MAILTO:qa@agenta.ai")).toBe(true)
        expect(isExternalHref("//example.com")).toBe(true)
        expect(isExternalHref("#section")).toBe(true)
        expect(isExternalHref(undefined)).toBe(true)
    })

    it("is false for a path, which may name a drive file", () => {
        expect(isExternalHref("/agent-files/report.md")).toBe(false)
        expect(isExternalHref("agent-files/report.md")).toBe(false)
    })
})

const anchor = (href: unknown) => ({
    type: "element",
    tagName: "a",
    properties: {href},
    children: [{type: "text", value: "report.md"}],
})

describe("rehypeExplicitRelativeLinks", () => {
    it("rewrites a nested anchor and leaves the rest of the tree intact", () => {
        const bare = anchor("agent-files/report.md")
        const web = anchor("https://example.com/a")
        const tree = {
            type: "root",
            children: [{type: "element", tagName: "p", properties: {}, children: [bare, web]}],
        }
        rehypeExplicitRelativeLinks()(tree)
        expect(bare.properties.href).toBe("./agent-files/report.md")
        expect(web.properties.href).toBe("https://example.com/a")
    })

    it("ignores an element that is not an anchor, and an anchor with no string href", () => {
        const img = {
            type: "element",
            tagName: "img",
            properties: {src: "agent-files/shot.png"},
            children: [],
        }
        const hrefless = anchor(undefined)
        const tree = {type: "root", children: [img, hrefless]}
        expect(() => rehypeExplicitRelativeLinks()(tree)).not.toThrow()
        expect(img.properties.src).toBe("agent-files/shot.png")
        expect(hrefless.properties.href).toBeUndefined()
    })
})

describe("decodeDriveHref", () => {
    it("undoes the percent-encoding harden's URL round-trip adds", () => {
        expect(decodeDriveHref("/agent-files/my report.md".replace(" ", "%20"))).toBe(
            "/agent-files/my report.md",
        )
    })

    it("returns a malformed escape unchanged rather than throwing", () => {
        expect(decodeDriveHref("/agent-files/100%.md")).toBe("/agent-files/100%.md")
    })
})
