import {describe, expect, it} from "vitest"

import {toPendingAttachment} from "../../../src/model/attachments"

describe("toPendingAttachment", () => {
    it("mints a unique per-row uid, so the same file staged twice stays two rows", () => {
        const file = new File(["hello"], "notes.txt", {lastModified: 1720000000000})
        const first = toPendingAttachment(file)
        const second = toPendingAttachment(file)
        expect(first).toMatchObject({file, name: "notes.txt"})
        expect(first.uid).toMatch(/^att-/)
        expect(second.uid).not.toBe(first.uid)
    })
})
