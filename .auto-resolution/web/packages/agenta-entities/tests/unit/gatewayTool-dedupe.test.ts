/**
 * Unit tests for dedupeBy — the crash-guard shared by the tool-catalog category and
 * integration hooks. Composio returns duplicate category slugs and paginated cursors
 * can overlap; a duplicate React key crashes the list render (see
 * `src/gatewayTool/hooks/useToolCatalog*.ts`). These tests pin the guard so a future
 * refactor to pagination or the category filter can't silently reintroduce the crash.
 */
import {describe, it, expect} from "vitest"

import {dedupeBy} from "../../src/gatewayTool/core/dedupe"

describe("dedupeBy", () => {
    it("removes later duplicates, keeping first occurrence and order", () => {
        const items = [
            {id: "a", n: 1},
            {id: "b", n: 2},
            {id: "a", n: 3},
            {id: "c", n: 4},
            {id: "b", n: 5},
        ]
        expect(dedupeBy(items, (i) => i.id)).toEqual([
            {id: "a", n: 1},
            {id: "b", n: 2},
            {id: "c", n: 4},
        ])
    })

    it("drops items whose key is falsy (null, undefined, empty)", () => {
        const items = [
            {key: "x"},
            {key: ""},
            {key: null as string | null},
            {key: undefined as string | undefined},
            {key: "y"},
        ]
        expect(dedupeBy(items, (i) => i.key)).toEqual([{key: "x"}, {key: "y"}])
    })

    it("tolerates null/undefined entries via the key accessor", () => {
        const items = [{id: "a"}, null, undefined, {id: "a"}, {id: "b"}]
        expect(dedupeBy(items, (i) => i?.id)).toEqual([{id: "a"}, {id: "b"}])
    })

    it("returns an empty array for empty input", () => {
        expect(dedupeBy([], (i: {id: string}) => i.id)).toEqual([])
    })

    it("does not mutate the input array", () => {
        const items = [{id: "a"}, {id: "a"}]
        const snapshot = [...items]
        dedupeBy(items, (i) => i.id)
        expect(items).toEqual(snapshot)
    })
})
