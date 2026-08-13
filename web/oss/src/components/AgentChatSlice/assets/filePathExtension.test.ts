import {createElement, type ReactNode} from "react"

import {XMarkdown} from "@ant-design/x-markdown"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {
    FILE_PATH_TAG,
    filePathExtension,
    matchSandboxPath,
    nextPathIndex,
} from "./filePathExtension"

const MOUNT = "/tmp/agenta/mounts/proj-1/mount-1"

/** Render markdown through the real XMarkdown pipeline (marked extension → DOMPurify → components),
 * with the file-path element mapped to a marker so a surviving token is visible in the output. */
const render = (content: string): string =>
    renderToStaticMarkup(
        createElement(XMarkdown, {
            content,
            config: {extensions: [filePathExtension]},
            components: {
                [FILE_PATH_TAG]: ({children}: {children?: ReactNode}) =>
                    createElement("mark", null, children),
            },
        }),
    )

describe("matchSandboxPath", () => {
    it("matches a sandbox path at the start of the input", () => {
        expect(matchSandboxPath(`${MOUNT}/README.md rest`)).toBe(`${MOUNT}/README.md`)
    })

    it("leaves trailing sentence punctuation out of the path", () => {
        expect(matchSandboxPath(`${MOUNT}/README.md.`)).toBe(`${MOUNT}/README.md`)
        expect(matchSandboxPath(`${MOUNT}/README.md).`)).toBe(`${MOUNT}/README.md`)
        expect(matchSandboxPath(`${MOUNT}/src/`)).toBe(`${MOUNT}/src`)
    })

    it("keeps a non-ASCII filename whole", () => {
        expect(matchSandboxPath(`${MOUNT}/résumé.md rest`)).toBe(`${MOUNT}/résumé.md`)
    })

    it("ignores paths outside the mounts and non-paths", () => {
        expect(matchSandboxPath("/etc/hosts")).toBeNull()
        expect(matchSandboxPath("/tmp")).toBeNull()
        expect(matchSandboxPath("//cloud.agenta.ai/x")).toBeNull()
        expect(matchSandboxPath("README.md")).toBeNull()
    })
})

describe("nextPathIndex", () => {
    it("finds a path that follows a word boundary", () => {
        const src = `I updated ${MOUNT}/README.md for you`
        expect(nextPathIndex(src)).toBe(src.indexOf(MOUNT))
    })

    it("skips slashes inside words and URLs", () => {
        expect(nextPathIndex("and/or, 12/25/2026")).toBeUndefined()
        expect(nextPathIndex(`https://cloud.agenta.ai${MOUNT}/README.md`)).toBeUndefined()
    })
})

describe("filePathExtension", () => {
    it("wraps a bare path in prose, and the element survives sanitization", () => {
        expect(render(`I updated ${MOUNT}/README.md for you`)).toContain(
            `<mark>${MOUNT}/README.md</mark>`,
        )
    })

    it("leaves inline code and fenced blocks untouched", () => {
        expect(render(`\`${MOUNT}/README.md\``)).not.toContain("<mark>")
        expect(render(`\`\`\`\n${MOUNT}/README.md\n\`\`\``)).not.toContain("<mark>")
    })

    it("leaves a link destination untouched", () => {
        const html = render(`[README](${MOUNT}/README.md)`)
        expect(html).toContain(`href="${MOUNT}/README.md"`)
        expect(html).not.toContain("<mark>")
    })

    it("leaves prose without a sandbox path alone", () => {
        expect(render("See /etc/hosts and and/or")).not.toContain("<mark>")
    })
})
