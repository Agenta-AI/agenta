/**
 * The approval card's workspace-content block.
 *
 * This is the one UI surface in the chat with a safety job: a human approves a commit on the
 * strength of what this renders. The rule it must never break is that the card never shows only
 * a byte count and a path — a field replaced from a file shows the diff of what it replaces, and
 * every imported file shows its size, digest, and executable bit.
 *
 * Rendered with `renderToStaticMarkup` rather than a testing library: the repo has no
 * `@testing-library/react`, and these are static presentational assertions that do not need one.
 */
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import ApprovedContentManifest, {
    parseApprovedContentManifest,
    type ApprovedContentManifestValue,
} from "./ApprovedContentManifest"

/**
 * Rendered text with tags stripped, so assertions do not straddle element boundaries.
 * Parsed by the test environment's DOM (vitest runs jsdom) rather than by regexes:
 * real parsing handles tags and entities correctly by construction.
 */
const text = (node: Parameters<typeof renderToStaticMarkup>[0]): string => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(node)
    return (host.textContent ?? "").replace(/\s+/g, " ").trim()
}

const file = (overrides: Record<string, unknown> = {}) => ({
    relativePath: "instructions.md",
    requestedPath: ".agenta-imports/instructions.md",
    bytes: 24,
    digest: "abcdef0123456789abcdef",
    executableBit: false,
    ...overrides,
})

const diff = (overrides: Record<string, unknown> = {}) => ({
    targetField: "instructions",
    baseRevisionId: "rev-1",
    oldBytes: 100,
    newBytes: 2048,
    oldLines: 4,
    newLines: 5,
    oldDigest: "old",
    newDigest: "new",
    diff: "@@ -1,2 +1,2 @@\n-be terse\n+be brief",
    addedLines: 1,
    removedLines: 1,
    diffTruncated: false,
    diffCoarse: false,
    ...overrides,
})

const manifest = (
    overrides: Partial<ApprovedContentManifestValue> = {},
): ApprovedContentManifestValue => ({
    files: [file()],
    diffs: [],
    totalBytes: 24,
    contentDigest: "0123456789abcdef0123",
    ...overrides,
})

describe("parseApprovedContentManifest", () => {
    it("returns null for anything that is not a manifest", () => {
        for (const value of [undefined, null, "x", 42, []]) {
            expect(parseApprovedContentManifest(value)).toBeNull()
        }
    })

    it("returns null when the manifest carries neither files nor diffs", () => {
        // Rendering an empty shell would imply the commit imports nothing, which is a claim.
        expect(parseApprovedContentManifest({files: [], diffs: []})).toBeNull()
    })

    it("keeps files, diffs, totals, and the digest", () => {
        const parsed = parseApprovedContentManifest({
            files: [file()],
            diffs: [diff()],
            totalBytes: 24,
            contentDigest: "digest",
        })
        expect(parsed?.files).toHaveLength(1)
        expect(parsed?.diffs).toHaveLength(1)
        expect(parsed?.totalBytes).toBe(24)
        expect(parsed?.contentDigest).toBe("digest")
    })

    it("defaults a missing total and digest rather than dropping the manifest", () => {
        const parsed = parseApprovedContentManifest({files: [file()]})
        expect(parsed).not.toBeNull()
        expect(parsed?.totalBytes).toBe(0)
        expect(parsed?.contentDigest).toBe("")
    })
})

describe("the imported file list", () => {
    it("shows each file's path, size, and digest", () => {
        const rendered = text(<ApprovedContentManifest manifest={manifest()} />)

        expect(rendered).toContain("instructions.md")
        expect(rendered).toContain("24 B")
        // Truncated for the card; the full value is bound by the authorization, not shown.
        expect(rendered).toContain("abcdef012345")
    })

    it("labels the file digest and the whole-change digest as different things", () => {
        // The card shows two digests with different SCOPES: this file's bytes, and the fully
        // resolved arguments. Unlabelled, a reviewer reads the two hexes as a mismatch.
        const rendered = text(<ApprovedContentManifest manifest={manifest()} />)

        expect(rendered).toContain("file digest")
        expect(rendered).toContain("whole-change digest")
    })

    it("flags an executable file, and says nothing for a plain one", () => {
        const plain = text(<ApprovedContentManifest manifest={manifest()} />)
        expect(plain).not.toContain("executable")

        const executable = text(
            <ApprovedContentManifest
                manifest={manifest({
                    files: [file({relativePath: "scripts/check.py", executableBit: true})],
                })}
            />,
        )
        expect(executable).toContain("executable")
        expect(executable).toContain("scripts/check.py")
    })

    it("totals the imported bytes in the section header", () => {
        const rendered = text(
            <ApprovedContentManifest
                manifest={manifest({
                    files: [file(), file({relativePath: "b.md", bytes: 2048})],
                    totalBytes: 2072,
                })}
            />,
        )
        expect(rendered).toContain("From your workspace")
        expect(rendered).toContain("2.0 KB")
    })

    it("states that the digest covers the FULL content, not the shown view", () => {
        // Without this sentence a shortened card implies a partial approval.
        const rendered = text(<ApprovedContentManifest manifest={manifest()} />)
        expect(rendered).toContain("0123456789ab")
        expect(rendered).toMatch(/covering the full text, not only what is shown/)
        // The two digests must stay distinguishable, not just both present.
        expect(rendered).not.toContain("abcdef012345, covering")
    })
})

describe("the single-text diff", () => {
    it("renders the unified diff, its counts, and the size change", () => {
        const rendered = text(<ApprovedContentManifest manifest={manifest({diffs: [diff()]})} />)

        expect(rendered).toContain("Replace instructions")
        expect(rendered).toContain("-be terse")
        expect(rendered).toContain("+be brief")
        expect(rendered).toContain("@@ -1,2 +1,2 @@")
        expect(rendered).toContain("+1")
        expect(rendered).toContain("−1") // a real minus sign, not a hyphen
        expect(rendered).toContain("100 B")
        expect(rendered).toContain("2.0 KB")
    })

    it("offers the full diff when the preview clips a long one", () => {
        const long = Array.from({length: 120}, (_, i) => `+line ${i}`).join("\n")
        const rendered = text(
            <ApprovedContentManifest
                manifest={manifest({diffs: [diff({diff: long, addedLines: 120})]})}
            />,
        )

        expect(rendered).toContain("Show all 120 diff lines")
        expect(rendered).toContain("+line 0")
        // Clipped at the preview bound, so a late line is not in the initial render.
        expect(rendered).not.toContain("+line 119")
    })

    it("does not offer a full-diff toggle for a short diff", () => {
        const rendered = text(<ApprovedContentManifest manifest={manifest({diffs: [diff()]})} />)
        expect(rendered).not.toContain("Show all")
    })

    it("says so when the runner shortened the diff at its cap", () => {
        // The runner caps the unified diff at 400 lines; the counts stay exact above it, and the
        // card has to say that or a shortened diff reads as the whole change.
        const rendered = text(
            <ApprovedContentManifest
                manifest={manifest({
                    diffs: [diff({diffTruncated: true, addedLines: 900, removedLines: 850})],
                })}
            />,
        )

        expect(rendered).toContain("the counts above cover the whole change")
        expect(rendered).toContain("+900")
    })

    it("renders every diff when one commit replaces several fields", () => {
        const rendered = text(
            <ApprovedContentManifest
                manifest={manifest({
                    diffs: [
                        diff(),
                        diff({targetField: "skills pdf-tools / body", diff: "@@ -1 +1 @@\n+x"}),
                    ],
                })}
            />,
        )

        expect(rendered).toContain("Replace instructions")
        expect(rendered).toContain("Replace skills pdf-tools / body")
    })

    it("renders a diff-only manifest with no file section", () => {
        const rendered = text(
            <ApprovedContentManifest manifest={manifest({files: [], diffs: [diff()]})} />,
        )
        expect(rendered).toContain("Replace instructions")
        expect(rendered).not.toContain("From your workspace")
    })
})
