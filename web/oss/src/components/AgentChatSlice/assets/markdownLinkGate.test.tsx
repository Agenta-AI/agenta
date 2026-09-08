/** Which link shapes survive Streamdown's harden gate, and in what spelling (#6659). */
import {rehypeExplicitRelativeLinks} from "@agenta/entity-ui/drive"
import {renderToStaticMarkup} from "react-dom/server"
import {defaultRehypePlugins, Streamdown, type Components} from "streamdown"
import {describe, expect, it} from "vitest"

const REHYPE_PLUGINS = [
    defaultRehypePlugins.raw,
    defaultRehypePlugins.sanitize,
    rehypeExplicitRelativeLinks,
    defaultRehypePlugins.harden,
]

const components: Components = {
    a: ({href, children}) => <a data-href={String(href)}>{children}</a>,
}

/** The href the anchor slot receives, or "[blocked]" when the gate dropped it. */
const gate = (markdown: string, plugins = REHYPE_PLUGINS): string => {
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

    it("blocked every relative shape before the fix", () => {
        // Streamdown's stock list: the before column of the table.
        const stock = Object.values(defaultRehypePlugins)
        expect(gate(link("agent-files/report.md"), stock)).toBe("[blocked]")
        expect(gate(link("report.md"), stock)).toBe("[blocked]")
        expect(gate(link("./agent-files/report.md"), stock)).toBe("/agent-files/report.md")
    })
})
