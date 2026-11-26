/**
 * A quick-look opener hands the drive whatever path it holds — a recents row's drive path, or a raw
 * TOOL path off an in-thread file card. `resolveQuickLookPath` is the one place that turns either
 * into the path the explorer selects by, and #6270 is what happens when it doesn't: a sandbox
 * absolute path reaches the explorer, which browses it as a folder INSIDE the mount and lands on
 * `<mount>/tmp/agenta/mounts/<ids>/` — an empty directory, named with the ids of whichever run
 * happened to write the file.
 */
import {describe, expect, it} from "vitest"

import {resolveQuickLookPath} from "../../src/drive/SessionFilesDrawer"

const recents = [{path: "notes/a.md"}, {path: "agent-files/SKILL.md"}]

describe("resolveQuickLookPath", () => {
    it("prefers the drive path of a recents row the request tail-matches", () => {
        expect(resolveQuickLookPath(recents, "/tmp/agenta/mounts/p/m/notes/a.md")).toBe(
            "notes/a.md",
        )
        expect(resolveQuickLookPath(recents, "notes/a.md")).toBe("notes/a.md")
    })

    // An absolute tool path names exactly ONE drive path, so a tail match is too loose: a row for
    // a DIFFERENT file that happens to share the basename sits at the tail of the request too, and
    // whichever the recency sort put first would win.
    it("does not let a shorter row win on a shared basename", () => {
        const colliding = [{path: "a.md"}, {path: "src/a.md"}]
        expect(resolveQuickLookPath(colliding, "/tmp/agenta/mounts/p/m/src/a.md")).toBe("src/a.md")
        // Order must not decide it.
        expect(
            resolveQuickLookPath([...colliding].reverse(), "/tmp/agenta/mounts/p/m/src/a.md"),
        ).toBe("src/a.md")
        expect(resolveQuickLookPath(colliding, "/tmp/agenta/mounts/p/m/a.md")).toBe("a.md")
    })

    it("strips the sandbox root when the request matches no recents row", () => {
        expect(resolveQuickLookPath(recents, "/tmp/agenta/mounts/p/m/deep/report.json")).toBe(
            "deep/report.json",
        )
        expect(resolveQuickLookPath([], "/home/sandbox/agenta/mounts/p/m/out.txt")).toBe("out.txt")
    })

    it("folds the agent mount's sibling path under `agent-files/`", () => {
        expect(resolveQuickLookPath([], "/tmp/agenta/mounts/p/m-agent/skills/SKILL.md")).toBe(
            "agent-files/skills/SKILL.md",
        )
    })

    it("leaves a path it cannot place alone rather than inventing a location for it", () => {
        expect(resolveQuickLookPath([], "/etc/hosts")).toBe("/etc/hosts")
    })
    it("reads an absolute presented path as the drive's own", () => {
        expect(resolveQuickLookPath([], "/agent-files/out/a.png")).toBe("agent-files/out/a.png")
        expect(resolveQuickLookPath([{path: "notes.md"}], "/notes.md")).toBe("notes.md")
    })
})

// #7715: the chat hands a relative `agent-files/...` link over as `/agent-files/...`. A folder in it
// named like a throwaway run dir (`agenta-outreach-agent`) must not cut the path or move it.
describe("resolveQuickLookPath with a user folder named `agenta-*`", () => {
    it("keeps the presented agent-files path whole", () => {
        expect(
            resolveQuickLookPath([], "/agent-files/agenta-outreach-agent/library/persona.md"),
        ).toBe("agent-files/agenta-outreach-agent/library/persona.md")
        expect(
            resolveQuickLookPath(
                [{path: "agent-files/README.md"}],
                "/agent-files/agenta-outreach-agent/README.md",
            ),
        ).toBe("agent-files/agenta-outreach-agent/README.md")
    })

    it("keeps a session path under such a folder whole", () => {
        expect(
            resolveQuickLookPath([{path: "notes/agenta-demo/a.md"}], "/notes/agenta-demo/a.md"),
        ).toBe("notes/agenta-demo/a.md")
    })
})

describe("resolveQuickLookPath with drives", () => {
    it("keeps an absolute drives/<slug>/ path as the drive's own path", () => {
        expect(
            resolveQuickLookPath(recents, "/drives/price-lists/2026.md", [{slug: "price-lists"}]),
        ).toBe("drives/price-lists/2026.md")
    })

    it("presents a drive mount's path under drives/<slug>/, and the home under agent-files/", () => {
        const drives = [{slug: "price-lists"}]
        expect(
            resolveQuickLookPath([], "/var/lib/agenta/mounts/p/m-drive-price-lists/a.csv", drives),
        ).toBe("drives/price-lists/a.csv")
        expect(
            resolveQuickLookPath(
                [],
                "/var/lib/agenta/mounts/p/m-drive-quote-files/b.md",
                drives,
                "quote-files",
            ),
        ).toBe("agent-files/b.md")
    })

    it("presents the home drive at the root only when it is the whole drive", () => {
        const request = "/var/lib/agenta/mounts/p/m-drive-quote-files/b.md"
        // A session file with the same name is not the home drive's file.
        expect(resolveQuickLookPath([{path: "b.md"}], request, [], "quote-files")).toBe(
            "agent-files/b.md",
        )
        expect(resolveQuickLookPath([{path: "b.md"}], request, [], "quote-files", true)).toBe(
            "b.md",
        )
    })

    it("keeps a path in a configured drive that has no mount yet off the session files", () => {
        expect(
            resolveQuickLookPath([{path: "a.md"}], "drives/prices/a.md", [{slug: "prices"}]),
        ).toBe("drives/prices/a.md")
    })
})

describe("resolveQuickLookPath prefers a full path over a shorter tail", () => {
    const rows = [{path: "a.md"}, {path: "drives/prices/a.md"}]

    it("keeps a complete relative drive path", () => {
        expect(resolveQuickLookPath(rows, "drives/prices/a.md")).toBe("drives/prices/a.md")
    })

    it("keeps a configured drive path even before it is listed", () => {
        expect(
            resolveQuickLookPath([{path: "a.md"}], "drives/prices/a.md", [{slug: "prices"}]),
        ).toBe("drives/prices/a.md")
    })

    it("never opens a session file for a path under a drive's own mount", () => {
        expect(
            resolveQuickLookPath([{path: "a.md"}], "/var/lib/agenta/mounts/s/m-drive-prices/a.md", [
                {slug: "prices"},
            ]),
        ).toBe("drives/prices/a.md")
    })
})
