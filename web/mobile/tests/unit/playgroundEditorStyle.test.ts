// @vitest-environment jsdom
/**
 * The playground's message editors: they fit their text and use the app font, as on /w. The
 * agent config and the trace drawer render the same editor outside the playground, so the rules
 * apply only under `[data-playground]` and those surfaces keep the editor theme as it is.
 *
 * The real stylesheets are loaded: the shared editor theme (its 150 px minimum height), and the
 * app's globals.css.
 */
import {readFileSync} from "node:fs"
import {createRequire} from "node:module"
import {resolve} from "node:path"

import {beforeAll, describe, expect, it} from "vitest"

const require = createRequire(import.meta.url)

/** One message editor as the shared editor renders it, in its text view. */
const MESSAGE = `
<div class="agenta-chat-message-editor">
  <div class="message-user-select">System</div>
  <div class="editor-container">
    <div class="editor-inner">
      <div class="editor-input markdown-view"><code class="editor-code">Hello</code></div>
      <div class="editor-placeholder"></div>
    </div>
  </div>
</div>`

/** The run status tag as the shared Badge renders it. A menu trigger replaces its `data-slot`. */
const SUCCESS = `<span data-slot="dropdown-menu-trigger" class="bg-success-bg text-success">Success</span>`

beforeAll(() => {
    const theme = readFileSync(require.resolve("@agenta/ui/editor-theme.css"), "utf8")
    const globals = readFileSync(resolve(__dirname, "../../src/styles/globals.css"), "utf8")
    // Tailwind's preflight gives `code` the monospace face; the editor text sits in a `<code>`.
    const preflight = "code { font-family: ui-monospace, monospace; font-size: 1em; }"
    for (const css of [preflight, theme, globals]) {
        const style = document.createElement("style")
        style.textContent = css
        document.head.append(style)
    }
    document.body.innerHTML = `
        <div id="playground" data-playground>${MESSAGE}${SUCCESS}</div>
        <div id="elsewhere">${MESSAGE}${SUCCESS}</div>`
})

const styleOf = (scope: string, selector: string) =>
    getComputedStyle(document.querySelector(`#${scope} ${selector}`)!)

describe("Playground message editor style", () => {
    it("fits its text instead of keeping a 150 px minimum height", () => {
        expect(styleOf("playground", ".editor-input").minHeight).toBe("0")
    })

    it("shows the message in the app font at 13 px, not the code font", () => {
        const text = styleOf("playground", ".editor-code")
        expect(text.fontFamily).not.toMatch(/monospace/)
        expect(text.fontSize).toBe("13px")
    })

    it("starts the text at the role label's inset", () => {
        // jsdom does not resolve custom properties: both read the same inset variable.
        const inset = (selector: string) =>
            styleOf("playground", selector).getPropertyValue("padding-inline")
        expect(inset(".editor-input")).toBe("var(--ag-message-inline-pad)")
        expect(inset(".message-user-select")).toBe("var(--ag-message-inline-pad)")
    })

    it("paints the Success tag with its green background", () => {
        expect(styleOf("playground", ".bg-success-bg").backgroundColor).toBe(
            "var(--ag-colorSuccessBg)",
        )
    })

    it("paints the draft tag and the flow chips in their colours", () => {
        const host = document.createElement("div")
        host.setAttribute("data-playground", "")
        host.innerHTML = `<span id="draft" class="bg-draft-bg text-draft">Draft</span><span id="chip" class="bg-tag-green-bg text-tag-green">Score</span>`
        document.body.append(host)
        expect(getComputedStyle(host.querySelector("#draft")!).backgroundColor).toBe(
            "var(--ag-draft-bg)",
        )
        expect(getComputedStyle(host.querySelector("#chip")!).color).toBe(
            "var(--ag-preset-green-text)",
        )
        host.remove()
    })

    it("leaves the same editor outside the playground as it was", () => {
        expect(styleOf("elsewhere", ".editor-input").minHeight).toBe("150px")
        expect(styleOf("elsewhere", ".editor-code").fontFamily).toMatch(/monospace/)
        expect(styleOf("elsewhere", ".bg-success-bg").backgroundColor).toBe("rgba(0, 0, 0, 0)")
    })
})
