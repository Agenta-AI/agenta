/** A chat file lookup picks the most specific listed path, never a shorter one sharing its tail. */
import {describe, expect, it} from "vitest"

import {findDriveEntry} from "../../src/drive/useDriveFileLookup"

const files = [{path: "a.md"}, {path: "drives/prices/a.md"}]

describe("findDriveEntry", () => {
    it("selects the drive file over a session file that shares its tail", () => {
        expect(findDriveEntry(files, "drives/prices/a.md")).toEqual({path: "drives/prices/a.md"})
        expect(findDriveEntry(files, "/var/lib/agenta/mounts/s/m/drives/prices/a.md")).toEqual({
            path: "drives/prices/a.md",
        })
    })

    it("still matches a session file by its tail", () => {
        expect(findDriveEntry(files, "/var/lib/agenta/mounts/s/m/a.md")).toEqual({path: "a.md"})
    })

    it("maps a path under a drive's own mount to that drive, never to a session file", () => {
        const drive = "/var/lib/agenta/mounts/s/m-drive-prices/a.md"
        expect(findDriveEntry(files, drive)).toEqual({path: "drives/prices/a.md"})
        expect(findDriveEntry([{path: "a.md"}], drive)).toBeNull()
        const home = [{path: "a.md"}, {path: "agent-files/a.md"}]
        expect(
            findDriveEntry(home, "/var/lib/agenta/mounts/s/m-drive-own/a.md", false, "own"),
        ).toEqual({path: "agent-files/a.md"})
        expect(findDriveEntry(home, "/var/lib/agenta/mounts/s/m-agent/a.md")).toEqual({
            path: "agent-files/a.md",
        })
    })

    it("keeps a home drive shown at the root at the root, a real agent-files folder aside", () => {
        const both = [{path: "a.md"}, {path: "agent-files/a.md"}]
        const tool = "/var/lib/agenta/mounts/s/m-agent/a.md"
        expect(findDriveEntry(both, tool, false, null, "")).toEqual({path: "a.md"})
    })

    it("maps the home drive reached through its drives/<slug>/ link to agent-files/", () => {
        const both = [{path: "report.md"}, {path: "agent-files/report.md"}]
        for (const path of [
            "drives/home/report.md",
            "/var/lib/agenta/mounts/s/m/drives/home/report.md",
        ])
            expect(findDriveEntry(both, path, false, "home")).toEqual({
                path: "agent-files/report.md",
            })
        expect(
            findDriveEntry([{path: "report.md"}], "drives/home/report.md", false, "home"),
        ).toBeNull()
    })

    it("takes a drive path as is when exact", () => {
        expect(findDriveEntry(files, "a.md", true)).toEqual({path: "a.md"})
        expect(findDriveEntry(files, "b.md", true)).toBeNull()
    })
})
