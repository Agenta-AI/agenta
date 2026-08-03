import {describe, expect, it} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS, kindForType, validateIncoming} from "./attachments"

const MB = 1024 * 1024

const file = (name: string, type: string, size: number): File => ({name, type, size}) as File

describe("attachment validation", () => {
    it("accepts an unrecognized media type through the other bucket", () => {
        const archive = file("bundle.zip", "application/zip", 1)

        expect(kindForType(archive.type)).toBe("other")
        expect(validateIncoming([archive], 0)).toEqual({accepted: [archive], rejections: []})
    })

    it("enforces the 10 MB cap for the other bucket", () => {
        const archive = file("bundle.zip", "application/zip", 10 * MB + 1)

        const result = validateIncoming([archive], 0)

        expect(result.accepted).toEqual([])
        expect(result.rejections).toEqual([
            {
                name: "bundle.zip",
                reason: "is too large (10.0 MB) · max 10.0 MB for other files",
            },
        ])
    })

    it("enforces the per-message count cap", () => {
        const image = file("photo.png", "image/png", 1)

        const result = validateIncoming([image], DEFAULT_ATTACHMENT_LIMITS.maxCount)

        expect(result.accepted).toEqual([])
        expect(result.rejections).toEqual([
            {
                name: "photo.png",
                reason: `exceeds the ${DEFAULT_ATTACHMENT_LIMITS.maxCount}-file limit`,
            },
        ])
    })
})
