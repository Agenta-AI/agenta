import {describe, expect, it} from "vitest"

import {buildDriveTree} from "../../src/drive/driveTree"
import type {MountFile} from "../../src/session"

const file = (path: string, size = 1): MountFile => ({path, size}) as unknown as MountFile

describe("buildDriveTree", () => {
    it("keeps one node per path, the first listing winning", () => {
        const tree = buildDriveTree([file("a.md", 10), file("dir/b.md"), file("a.md", 99)])
        expect(tree.map((n) => n.path)).toEqual(["dir", "a.md"])
        expect(tree.find((n) => n.path === "a.md")?.size).toBe(10)
    })
})
