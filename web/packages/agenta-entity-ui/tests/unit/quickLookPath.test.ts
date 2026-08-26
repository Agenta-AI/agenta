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
})
