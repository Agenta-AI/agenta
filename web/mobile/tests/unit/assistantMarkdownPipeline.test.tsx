// @vitest-environment jsdom
/**
 * `/m` end to end through the real markdown pipeline (#6666).
 *
 * The sibling suite calls the anchor renderer directly, which cannot catch a missing rehype
 * plugin, a parser transformation, or a renderer that stopped using the component map. This one
 * renders `AssistantMarkdown` itself, so the only things stubbed are the typewriter clock and the
 * drive resolution, and every link goes through Streamdown, harden and the real anchor.
 */
import {type ReactNode} from "react"

import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

const resolved: string[] = []

vi.mock("@agenta/chat/hooks", () => ({
    // Reveal the whole text at once; the reveal animation is not what this suite is about.
    useTypewriter: (target: string) => ({text: target, settled: true}),
}))

vi.mock("@agenta/entity-ui/drive", async (original) => ({
    ...(await original<object>()),
    chatFileResolver: {
        renderCode: (text: string, fallback: ReactNode) => {
            resolved.push(text)
            return fallback
        },
    },
}))

const {AssistantMarkdown} = await import("@/features/chat/AssistantMarkdown")

const render = (markdown: string, streaming = false): string =>
    renderToStaticMarkup(<AssistantMarkdown streaming={streaming} text={markdown} />)

const link = (target: string) => `Created [report.md](${target}) for you.`

describe("mobile assistant markdown, through the real pipeline", () => {
    it("never renders a target that names a host as a link", () => {
        for (const target of [
            "..//evil.com/x",
            "//evil.com/x",
            "a/..//evil.com/x",
            ".././/evil.com/x",
            "..//EVIL.com/x",
            "..//evil.com/x?a=1",
            "%2F%2Fevil.com",
            "\\\\evil.com",
            "/\\evil.com",
        ]) {
            const html = render(link(target))
            expect(html, target).not.toContain("<a")
            expect(html, target).not.toContain("href=")
        }
    })

    it("blocks the target harden hands over as a host, in streaming mode too", () => {
        // Incomplete-markdown repair runs while a reply streams, so the shape has to be refused
        // on that path as well as the settled one.
        for (const streaming of [false, true]) {
            const html = render(link("..//evil.com/x"), streaming)
            expect(html, String(streaming)).toContain("[blocked]")
            expect(html, String(streaming)).not.toContain("<a")
        }
    })

    it("refuses the same target written as raw HTML", () => {
        // `rehype-raw` admits the anchor, so it reaches the same component map.
        const html = render('<a href="..//evil.com/x">report.md</a>')
        expect(html).not.toContain("<a")
        expect(html).not.toContain("href=")
        expect(html).toContain("[blocked]")
    })

    it("still opens an ordinary web link in a new tab", () => {
        const html = render(link("https://example.com/report.md"))
        expect(html).toContain('href="https://example.com/report.md"')
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noopener noreferrer"')
    })

    it("still opens a bare web link written as an autolink", () => {
        const html = render("See <https://example.com/report.md> for the numbers.")
        expect(html).toContain('href="https://example.com/report.md"')
        expect(html).toContain('target="_blank"')
    })

    it("still sends the file link the platform prompt prescribes to the drive resolver", () => {
        resolved.length = 0
        const html = render(link("agent-files/report.md"))
        expect(html).not.toContain("[blocked]")
        // Harden respells it to the leading-slash form the drive resolver handles.
        expect(resolved).toContain("/agent-files/report.md")
    })

    it("decodes a percent-encoded file name on the way to the resolver", () => {
        resolved.length = 0
        render(link("<agent-files/my report.md>"))
        expect(resolved).toContain("/agent-files/my report.md")
    })
})
