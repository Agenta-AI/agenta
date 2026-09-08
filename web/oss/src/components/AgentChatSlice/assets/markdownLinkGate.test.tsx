/**
 * The chat's link gate, end to end through the REAL Streamdown rehype pipeline.
 *
 * Streamdown ends its pipeline in `rehype-harden`, which replaces any anchor whose href it cannot
 * parse with an inert `<span>… [blocked]</span>`. It could not parse a bare relative path, which is
 * exactly the form the platform prompt tells the agent to write, so every file link an agent
 * produced rendered as dead grey text (#6659). These cases pin one row each of the link-shape table
 * and, just as importantly, pin what stays blocked.
 *
 * The `a` slot is stubbed to emit the href it receives: what this asserts is which shapes SURVIVE
 * the gate and in what spelling, not how the app renders them afterwards.
 */
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

/** The href the anchor slot receives, or "[blocked]" when the gate dropped the anchor. */
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
        // The regression: this exact shape used to come back "[blocked]".
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
        // Markdown spells a destination with a space in angle brackets. `decodeDriveHref` undoes
        // the encoding before the drive resolves the path.
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
        // Same pipeline, Streamdown's stock plugin list — the before column of the table.
        const stock = Object.values(defaultRehypePlugins)
        expect(gate(link("agent-files/report.md"), stock)).toBe("[blocked]")
        expect(gate(link("report.md"), stock)).toBe("[blocked]")
        expect(gate(link("./agent-files/report.md"), stock)).toBe("/agent-files/report.md")
    })
})
