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

    it("takes a drive path as is when exact", () => {
        expect(findDriveEntry(files, "a.md", true)).toEqual({path: "a.md"})
        expect(findDriveEntry(files, "b.md", true)).toBeNull()
    })
})
