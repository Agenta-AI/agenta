import {describe, expect, it} from "vitest"

import {columnHeaderTarget} from "@/features/testsets/detail/columnHeaderTarget"

const columns = [
    {key: "question", label: "question"},
    {key: "meta.lang", label: "lang", parentKey: "meta"},
    {key: "meta.tone", label: "tone", parentKey: "meta"},
    {key: "ctx.a", label: "a"},
    {key: "ctx.b", label: "b"},
]

const header = (key: string, isGroup: boolean, groupPath: string | null = null) => ({
    key,
    label: key,
    title: key,
    isGroup,
    groupPath,
})

describe("columnHeaderTarget", () => {
    it("A top-level column changes its own key", () => {
        expect(columnHeaderTarget(header("question", false), columns)).toEqual(["question"])
    })

    it("A column inside a nested value has no actions", () => {
        expect(columnHeaderTarget(header("meta.lang", false, "meta"), columns)).toBeNull()
    })

    it("A group of nested values is deleted by its top-level key", () => {
        expect(columnHeaderTarget(header("meta", true), columns)).toEqual(["meta"])
    })

    it("A group of dotted top-level keys deletes each key", () => {
        expect(columnHeaderTarget(header("ctx", true), columns)).toEqual(["ctx.a", "ctx.b"])
        expect(columnHeaderTarget(header("ctx.a", false, "ctx"), columns)).toEqual(["ctx.a"])
    })

    it("A group inside a group has no actions", () => {
        expect(columnHeaderTarget(header("meta.x", true, "meta"), columns)).toBeNull()
    })
})
