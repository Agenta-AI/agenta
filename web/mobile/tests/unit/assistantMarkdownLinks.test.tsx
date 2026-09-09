// @vitest-environment jsdom
/** The anchor /m renders with: a path opens the file, a web link still opens a tab (#6659).
 * The map moved into the shared `ChatMarkdown`, which /m and /w both render through, so this
 * drives it with the resolver `AssistantMarkdown` supplies. */
import {createElement, type ReactNode} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

const resolved: string[] = []

vi.mock("@agenta/entity-ui/drive", async (original) => ({
    // Only the resolution is stubbed; the gate helpers stay real.
    ...(await original<object>()),
    chatFileResolver: {
        renderCode: (text: string, fallback: ReactNode) => {
            resolved.push(text)
            return createElement("span", {"data-drive-path": text}, fallback)
        },
    },
}))

const {ChatMarkdownLinkResolverContext, MD_COMPONENTS} = await import("@agenta/chat/markdown")
const {chatFileResolver} = await import("@agenta/entity-ui/drive")

// The href reaches the anchor raw here, before harden can rewrite it — which is the layer the
// host check runs at. What the whole pipeline does with each shape is the oss link-gate test.
const renderLink = (href: string): string => {
    const Anchor = MD_COMPONENTS.a
    if (!Anchor) throw new Error("no anchor renderer")
    return renderToStaticMarkup(
        createElement(
            ChatMarkdownLinkResolverContext.Provider,
            {value: () => chatFileResolver},
            createElement(Anchor, {href, children: "report.md"} as never),
        ),
    )
}

describe("mobile assistant markdown links", () => {
    it("sends a sandbox path to the drive resolver instead of navigating to it", () => {
        const html = renderLink("/agent-files/report.md")
        expect(resolved).toContain("/agent-files/report.md")
        expect(html).not.toContain("<a")
        expect(html).toContain("report.md")
    })

    it("decodes a percent-encoded name before resolving it", () => {
        renderLink("/agent-files/my%20report.md")
        expect(resolved).toContain("/agent-files/my report.md")
    })

    it("still opens an ordinary web link in a new tab, with the opener severed", () => {
        const html = renderLink("https://example.com/report.md")
        expect(html).toContain('href="https://example.com/report.md"')
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noopener noreferrer"')
    })

    it("refuses a target that names a host instead of a path (#6666)", () => {
        // Every spelling of a host that can reach the anchor.
        const targets = [
            "//evil.com/x",
            "..//evil.com/x",
            "a/..//evil.com/x",
            "//EVIL.com/x",
            "%2F%2Fevil.com",
            "%2f%2fevil.com",
            "\\\\evil.com",
            "/\\evil.com",
            "  //evil.com/x",
        ]
        for (const target of targets) {
            const before = resolved.length
            const html = renderLink(target)
            expect(html, target).not.toContain("<a")
            expect(html, target).toContain("[blocked]")
            // It never reaches the drive resolver either, so no file read is attempted for it.
            expect(resolved.length, target).toBe(before)
        }
    })

    it("keeps the file link the platform prompt prescribes working", () => {
        // `resolved` accumulates across the whole file, so read only what this render added.
        const before = resolved.length
        const html = renderLink("/agent-files/report.md")
        expect(html).not.toContain("[blocked]")
        expect(resolved.slice(before)).toEqual(["/agent-files/report.md"])
    })

    it("keeps a web link whose own path has a double slash", () => {
        const html = renderLink("https://example.com//deep/report.md")
        expect(html).toContain('href="https://example.com//deep/report.md"')
        expect(html).not.toContain("[blocked]")
    })
})
