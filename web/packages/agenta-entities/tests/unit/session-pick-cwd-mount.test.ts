/**
 * Pins how the session's working-directory mount is picked. The wire `slug` is a minted reserved
 * slug (`__ag__session__<uuid5>__cwd`), so selecting on `slug === "cwd"` never matched and the
 * drive silently ran on whichever mount the backend happened to return first.
 */
import {describe, expect, it} from "vitest"

import {pickCwdMount} from "../../src/session/core/mountSelection"
import type {Mount} from "../../src/session/core/schema"

const mount = (id: string, slug: string, name?: string | null): Mount => ({
    id,
    slug,
    name: name ?? null,
    session_id: "sess-1",
})

describe("pickCwdMount", () => {
    it("matches the canonical name regardless of position in the list", () => {
        const mounts = [
            mount("1", "__ag__session__abc__pi-sessions", "pi-sessions"),
            mount("2", "__ag__session__abc__cwd", "cwd"),
        ]
        expect(pickCwdMount(mounts)?.id).toBe("2")
    })

    it("falls back to the `__cwd` slug suffix when the name is missing", () => {
        const mounts = [
            mount("1", "__ag__session__abc__pi-sessions"),
            mount("2", "__ag__session__abc__cwd"),
        ]
        expect(pickCwdMount(mounts)?.id).toBe("2")
    })

    it("falls back to the first mount when neither name nor slug identifies a cwd", () => {
        const mounts = [
            mount("1", "__ag__session__abc__pi-sessions", "pi-sessions"),
            mount("2", "__ag__session__abc__notes", "notes"),
        ]
        expect(pickCwdMount(mounts)?.id).toBe("1")
    })

    it("returns null for an empty list", () => {
        expect(pickCwdMount([])).toBeNull()
    })
})
