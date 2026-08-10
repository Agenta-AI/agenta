import {describe, expect, it} from "vitest"

import {toPendingAttachment} from "../../../src/model/attachments"

describe("toPendingAttachment", () => {
    it("derives the same uid formula the desktop composer uses", () => {
        const file = new File(["hello"], "notes.txt", {lastModified: 1720000000000})
        expect(toPendingAttachment(file)).toEqual({
            file,
            uid: `notes.txt-1720000000000-${file.size}`,
            name: "notes.txt",
        })
    })
})
