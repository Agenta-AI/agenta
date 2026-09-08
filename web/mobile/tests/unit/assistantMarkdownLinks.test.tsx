// @vitest-environment jsdom
/**
 * /m renders assistant markdown with its own component map, so the desktop's file-link behaviour is
 * not inherited — it has to be wired here too. A link to a path is not a web address: navigating to
 * `https://<app-host>/agent-files/report.md` opens a page that does not exist, which is what /m did
 * for every sandbox path (#6535). It now goes to the same drive resolver the desktop uses, which
 * opens the file in the Files pane, so the working-directory-relative form the platform prompt
 * prescribes opens on both hosts (#6659).
 */
import {createElement, type ReactNode} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

const resolved: string[] = []

vi.mock("@agenta/entity-ui/drive", async (original) => ({
    // The real gate helpers; only the drive resolution is stubbed, so this test stays off the
    // session/mount queries and asserts the wiring instead.
    ...(await original<object>()),
    chatFileResolver: {
        renderCode: (text: string, fallback: ReactNode) => {
            resolved.push(text)
            return createElement("span", {"data-drive-path": text}, fallback)
        },
    },
}))

const {markdownComponents} = await import("@/features/chat/AssistantMarkdown")

const renderLink = (href: string): string => {
    const Anchor = markdownComponents.a
    if (!Anchor) throw new Error("no anchor renderer")
    return renderToStaticMarkup(createElement(Anchor, {href, children: "report.md"} as never))
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
})
