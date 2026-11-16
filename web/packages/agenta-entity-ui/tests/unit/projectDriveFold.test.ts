/**
 * The files pane with project drives: "Download all" spans them even when the session has no
 * mount of its own, and a drive that leaves the configuration leaves the tree's cached levels.
 */
import {describe, expect, it} from "vitest"

import {folderArchiveMounts} from "../../src/drive/DriveItemContextMenu"
import {driveArchiveMounts} from "../../src/drive/useDriveDownloadAll"
import {canMoveOrDelete} from "../../src/drive/useDriveWrites"
import {dropDirs} from "../../src/drive/useLazyDriveTree"

const prices = {slug: "price-lists", access: "read" as const, mount: {id: "m-prices"}}

describe("driveArchiveMounts", () => {
    it("zips the project drives under drives/<slug> beside the session and agent mounts", () => {
        const agent = {id: "m-agent"}
        expect(
            driveArchiveMounts({
                mount: {id: "m-cwd"},
                resolveMount: () => ({mount: agent, path: ""}),
                projectDrives: [prices],
            }),
        ).toEqual([
            {mountId: "m-cwd", prefix: ""},
            {mountId: "m-agent", prefix: "agent-files"},
            {mountId: "m-prices", prefix: "drives/price-lists"},
        ])
    })

    it("zips the project drives when the session has no mount of its own", () => {
        expect(
            driveArchiveMounts({mount: null, resolveMount: () => null, projectDrives: [prices]}),
        ).toEqual([{mountId: "m-prices", prefix: "drives/price-lists"}])
    })
})

describe("dropDirs", () => {
    it("drops a removed drive's levels and keeps the others", () => {
        const map = new Map<string, unknown>([
            ["", []],
            ["drives/old", []],
            ["drives/old/sub", []],
            ["drives/older", []],
            ["drives/kept", []],
        ])
        expect(dropDirs(map, ["drives/old"])).toEqual(["drives/old", "drives/old/sub"])
        expect([...map.keys()]).toEqual(["", "drives/older", "drives/kept"])
    })
})

describe("folderArchiveMounts", () => {
    const cwd = {id: "m-cwd"}
    const drive = {
        resolveMount: (path: string) =>
            path.startsWith("drives/price-lists")
                ? {mount: prices.mount, path: path.slice("drives/price-lists".length + 1)}
                : {mount: cwd, path},
        projectDrives: [prices],
    }

    // The API names a member by its mount path under the prefix: the cwd source scoped to `drives`
    // yields `drives/notes.md`, so a project drive must sit at `drives/<slug>/` beside it.
    it("zips the drives folder with each project drive at drives/<slug>/, beside its session files", () => {
        expect(folderArchiveMounts(drive, "drives")).toEqual([
            {mountId: "m-cwd", prefix: "", path: "drives"},
            {mountId: "m-prices", prefix: "drives/price-lists", path: ""},
        ])
    })

    it("zips a folder inside a project drive from that drive alone", () => {
        expect(folderArchiveMounts(drive, "drives/price-lists/2026")).toEqual([
            {mountId: "m-prices", prefix: "", path: "2026"},
        ])
    })

    it("zips the drives folder of a session with no mount from the project drives", () => {
        expect(
            folderArchiveMounts({resolveMount: () => null, projectDrives: [prices]}, "drives"),
        ).toEqual([{mountId: "m-prices", prefix: "drives/price-lists", path: ""}])
    })
})

describe("canMoveOrDelete", () => {
    const team = {slug: "team", access: "read-write" as const, mount: {id: "m-team"}}
    const drive = {
        resolveMount: (path: string) => {
            for (const d of [prices, team]) {
                const dir = `drives/${d.slug}`
                if (path === dir) return {mount: d.mount, path: "", readOnly: d.access === "read"}
                if (path.startsWith(`${dir}/`))
                    return {
                        mount: d.mount,
                        path: path.slice(dir.length + 1),
                        readOnly: d.access === "read",
                    }
            }
            return {mount: {id: "m-cwd"}, path}
        },
        projectDrives: [prices, team],
    }

    it("refuses mount roots and read drives, for rename as for delete", () => {
        expect(canMoveOrDelete(drive, "")).toBe(false)
        expect(canMoveOrDelete(drive, "agent-files")).toBe(false)
        expect(canMoveOrDelete(drive, "drives/team")).toBe(false)
        expect(canMoveOrDelete(drive, "drives/price-lists/2026.md")).toBe(false)
    })

    it("allows files in a writable drive and session files", () => {
        expect(canMoveOrDelete(drive, "drives/team/notes.md")).toBe(true)
        expect(canMoveOrDelete(drive, "notes.md")).toBe(true)
    })
})
