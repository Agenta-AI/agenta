import {describe, expect, it} from "vitest"

import {
    type AttachmentLimits,
    DEFAULT_ATTACHMENT_LIMITS,
    describeAccepted,
    formatBytes,
    isAcceptedType,
    validateIncoming,
} from "../../../src/assets/attachmentRules"

const makeFile = (name: string, type: string, size: number): File =>
    new File([new Uint8Array(size)], name, {type})

describe("isAcceptedType", () => {
    it("matches an exact type", () => {
        expect(isAcceptedType("application/pdf", DEFAULT_ATTACHMENT_LIMITS)).toBe(true)
    })

    it("matches a type/ prefix", () => {
        expect(isAcceptedType("image/png", DEFAULT_ATTACHMENT_LIMITS)).toBe(true)
    })

    it("accepts any type under the defaults (the 'other' kind is enabled)", () => {
        expect(isAcceptedType("application/zip", DEFAULT_ATTACHMENT_LIMITS)).toBe(true)
    })

    it("rejects a kind the limits exclude", () => {
        const narrowed = {
            ...DEFAULT_ATTACHMENT_LIMITS,
            kinds: ["image", "audio", "document"] as const,
        }
        expect(isAcceptedType("application/zip", {...narrowed, kinds: [...narrowed.kinds]})).toBe(
            false,
        )
    })
})

describe("formatBytes", () => {
    it("formats sub-KB sizes in bytes", () => {
        expect(formatBytes(512)).toBe("512 B")
    })

    it("formats sub-MB sizes in KB", () => {
        expect(formatBytes(820 * 1024)).toBe("820 KB")
    })

    it("formats MB-scale sizes with one decimal", () => {
        expect(formatBytes(4.2 * 1024 * 1024)).toBe("4.2 MB")
    })
})

describe("validateIncoming", () => {
    it("accepts a file within limits", () => {
        const file = makeFile("a.png", "image/png", 1024)
        const {accepted, rejections} = validateIncoming([file], 0)
        expect(accepted).toEqual([file])
        expect(rejections).toEqual([])
    })

    it("rejects a media type whose kind the limits exclude", () => {
        const limits = {
            ...DEFAULT_ATTACHMENT_LIMITS,
            kinds: ["image", "audio", "document"] as ("image" | "audio" | "document")[],
        }
        const file = makeFile("a.zip", "application/zip", 1024)
        const {accepted, rejections} = validateIncoming([file], 0, limits)
        expect(accepted).toEqual([])
        expect(rejections).toEqual([{name: "a.zip", reason: "isn't a supported file type"}])
    })

    it("rejects a file over its kind's byte limit", () => {
        const limits = {
            ...DEFAULT_ATTACHMENT_LIMITS,
            maxBytes: {...DEFAULT_ATTACHMENT_LIMITS.maxBytes, image: 100},
        }
        const file = makeFile("big.png", "image/png", 200)
        const {accepted, rejections} = validateIncoming([file], 0, limits)
        expect(accepted).toEqual([])
        expect(rejections).toEqual([
            {name: "big.png", reason: "is too large, max 100 B supported"},
        ])
    })

    it("rejects files once the remaining slot count is exhausted, keeping earlier ones in order", () => {
        const limits = {...DEFAULT_ATTACHMENT_LIMITS, maxCount: 2}
        const a = makeFile("a.png", "image/png", 10)
        const b = makeFile("b.png", "image/png", 10)
        const c = makeFile("c.png", "image/png", 10)
        // maxCount 2, 1 already attached → exactly 1 remaining slot: only `a` fits.
        const {accepted, rejections} = validateIncoming([a, b, c], 1, limits)
        expect(accepted).toEqual([a])
        expect(rejections).toEqual([
            {name: "b.png", reason: "exceeds the 2-file limit"},
            {name: "c.png", reason: "exceeds the 2-file limit"},
        ])
    })

    it("accounts for currentCount when computing remaining slots", () => {
        const limits = {...DEFAULT_ATTACHMENT_LIMITS, maxCount: 3}
        const a = makeFile("a.png", "image/png", 10)
        const {accepted, rejections} = validateIncoming([a], 3, limits)
        expect(accepted).toEqual([])
        expect(rejections).toEqual([{name: "a.png", reason: "exceeds the 3-file limit"}])
    })
})

// User-visible: the composer's empty state renders this ("Images and audio · up to N files").
describe("describeAccepted", () => {
    const withKinds = (kinds: AttachmentLimits["kinds"]): AttachmentLimits => ({
        ...DEFAULT_ATTACHMENT_LIMITS,
        kinds,
    })

    it("names a single kind", () => {
        expect(describeAccepted(withKinds(["image"]))).toBe("Images")
    })

    // A two-item list takes a bare "and" — "Images, and audio" is not English.
    it("joins two kinds without a comma", () => {
        expect(describeAccepted(withKinds(["image", "audio"]))).toBe("Images and audio")
    })

    it("keeps the serial comma from three kinds up", () => {
        expect(describeAccepted(withKinds(["image", "audio", "document"]))).toBe(
            "Images, audio, and documents",
        )
        expect(describeAccepted(withKinds(["image", "audio", "document", "other"]))).toBe(
            "Images, audio, documents, and other files",
        )
    })

    it("says so when nothing is accepted", () => {
        expect(describeAccepted(withKinds([]))).toBe("No attachments")
    })
})
