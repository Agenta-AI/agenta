/** Which link shapes survive Streamdown's harden gate, and in what spelling (#6659). */
import {renderToStaticMarkup} from "react-dom/server"
import {defaultRehypePlugins, Streamdown, type Components} from "streamdown"
import {describe, expect, it} from "vitest"

import Markdown, {MD_REHYPE_PLUGINS} from "./markdown"

const components: Components = {
    a: ({href, children}) => <a data-href={String(href)}>{children}</a>,
}

/** The href the anchor slot receives, or "[blocked]" when the gate dropped it. */
const gate = (markdown: string, plugins = MD_REHYPE_PLUGINS): string => {
    const html = renderToStaticMarkup(
        <Streamdown components={components} rehypePlugins={plugins} mode="static">
            {markdown}
        </Streamdown>,
    )
    if (html.includes("[blocked]")) return "[blocked]"
    return /data-href="([^"]*)"/.exec(html)?.[1] ?? "[no anchor]"
}

const link = (target: string) => `Created [report.md](${target}) for you.`

describe("chat markdown link gate", () => {
    it("keeps the working-directory-relative path the platform prompt prescribes (#6659)", () => {
        expect(gate(link("agent-files/report.md"))).toBe("/agent-files/report.md")
    })

    it("keeps a bare filename", () => {
        expect(gate(link("report.md"))).toBe("/report.md")
    })

    it("keeps an explicitly relative path, unchanged in meaning", () => {
        expect(gate(link("./agent-files/report.md"))).toBe("/agent-files/report.md")
    })

    it("keeps an absolute sandbox path verbatim, for mount-tail resolution (#5983)", () => {
        const path = "/tmp/agenta/mounts/p/m/agent-files/report.md"
        expect(gate(link(path))).toBe(path)
    })

    it("keeps a name with a space, percent-encoded on the way through", () => {
        // Angle brackets are how markdown spells a destination with a space.
        expect(gate(link("<agent-files/my report.md>"))).toBe("/agent-files/my%20report.md")
    })

    it("keeps an ordinary web link", () => {
        expect(gate(link("https://example.com/report.md"))).toBe("https://example.com/report.md")
    })

    it("still blocks a file: URL", () => {
        expect(gate(link("file:///tmp/agenta/report.md"))).toBe("[blocked]")
    })

    it("still blocks a javascript: URL", () => {
        expect(gate(link("javascript:alert(1)"))).toBe("[blocked]")
    })

    it("never turns a path into an off-site link, dot segments included", () => {
        // The pathname of `a/..//evil.com/x` is `//evil.com/x`, which a browser reads as a host.
        for (const target of ["a/..//evil.com/x", "a/%2e%2e//evil.com/x"]) {
            const html = renderToStaticMarkup(<Markdown content={link(target)} />)
            expect(html).not.toContain("<a ")
            expect(html).not.toContain('href="//evil.com')
            expect(html).toContain("[blocked]")
        }
    })

    it("still renders an ordinary web link as a real anchor", () => {
        const html = renderToStaticMarkup(
            <Markdown content={link("https://example.com/report.md")} />,
        )
        expect(html).toContain('href="https://example.com/report.md"')
        expect(html).toContain('target="_blank"')
    })

    it("never renders a target that names a host as a link (#6666)", () => {
        const targets = [
            "..//evil.com/x",
            "//evil.com/x",
            "a/..//evil.com/x",
            ".././/evil.com/x",
            "..//EVIL.com/x",
            "..//evil.com/x?a=1",
            "%2F%2Fevil.com",
            "%2f%2fevil.com",
            "\\\\evil.com",
            "/\\evil.com",
        ]
        for (const target of targets) {
            const html = renderToStaticMarkup(<Markdown content={link(target)} />)
            // No anchor at all, so there is nothing to click and no href to resolve. A refused
            // target still appears inside a `title`, the same place harden puts one it refused.
            expect(html, target).not.toContain("<a ")
            expect(html, target).not.toContain("href=")
            expect(html, target).toContain("report.md")
        }
    })

    it("is the anchor that refuses the shape harden hands over as a host (#6666)", () => {
        // `..//evil.com/x` starts with `../`, so harden parses it and returns its pathname,
        // `//evil.com/x`. The browser fills in the page scheme and leaves the app, so the anchor
        // has to be the one to say no. These are the targets that reach it in that shape.
        for (const target of ["..//evil.com/x", "a/..//evil.com/x", ".././/evil.com/x"]) {
            const html = renderToStaticMarkup(<Markdown content={link(target)} />)
            expect(html, target).toContain("[blocked]")
        }
        // Written with no dot segment, harden drops the host itself and hands over a bare path.
        // Nothing to block, and still not a link.
        const bare = renderToStaticMarkup(<Markdown content={link("//evil.com/x")} />)
        expect(bare).not.toContain("<a ")
        expect(bare).not.toContain("evil.com")
    })

    it("refuses it the same way harden refuses a bad scheme, so both read alike", () => {
        const blockedHere = renderToStaticMarkup(<Markdown content={link("..//evil.com/x")} />)
        const blockedByHarden = renderToStaticMarkup(
            <Markdown content={link("javascript:alert(1)")} />,
        )
        for (const html of [blockedHere, blockedByHarden]) {
            expect(html).toContain("<span")
            expect(html).toContain('title="Blocked URL:')
            expect(html).toContain("[blocked]")
        }
    })

    it("keeps the links a reply is allowed to have", () => {
        const web = renderToStaticMarkup(<Markdown content={link("https://example.com")} />)
        expect(web).toContain('href="https://example.com/"')
        expect(web).toContain('target="_blank"')
        expect(web).not.toContain("[blocked]")

        // A web link whose own path has a double slash is a link, not a host escape.
        const doubled = renderToStaticMarkup(<Markdown content={link("https://example.com//a")} />)
        expect(doubled).toContain('href="https://example.com//a"')

        // The file link the platform prompt prescribes still reaches the drive resolver.
        const file = renderToStaticMarkup(<Markdown content={link("agent-files/report.md")} />)
        expect(file).not.toContain("[blocked]")
        expect(file).toContain("report.md")
    })

    it("blocked every relative shape before the fix", () => {
        // Streamdown's stock list: the before column of the table.
        const stock = Object.values(defaultRehypePlugins)
        expect(gate(link("agent-files/report.md"), stock)).toBe("[blocked]")
        expect(gate(link("report.md"), stock)).toBe("[blocked]")
        expect(gate(link("./agent-files/report.md"), stock)).toBe("/agent-files/report.md")
    })
})
