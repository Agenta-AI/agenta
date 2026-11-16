/**
 * The files pane with project drives: "Download all" spans them even when the session has no
 * mount of its own, and a drive that leaves the configuration leaves the tree's cached levels.
 */
import {describe, expect, it} from "vitest"

import {driveArchiveMounts} from "../../src/drive/useDriveDownloadAll"
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
