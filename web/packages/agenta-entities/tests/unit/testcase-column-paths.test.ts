import {describe, expect, it} from "vitest"

import {
    collectColumnPaths,
    extractColumnsFromData,
    type ColumnPathInfo,
} from "../../src/testcase/core"

describe("column paths", () => {
    it("A nested column keeps a key with a dot as one path segment", () => {
        const columns = extractColumnsFromData([
            {data: {"meta.lang": {source: "x"}, inputs: {question: "Q"}, plain: "p"}},
        ])
        expect(columns).toEqual([
            {
                key: "meta.lang.source",
                label: "source",
                parentKey: "meta.lang",
                path: ["meta.lang", "source"],
            },
            {
                key: "inputs.question",
                label: "question",
                parentKey: "inputs",
                path: ["inputs", "question"],
            },
            {key: "plain", label: "plain", parentKey: undefined, path: ["plain"]},
        ])
    })

    it("A walk that starts below the row keeps the ancestors in the path", () => {
        const results = new Map<string, ColumnPathInfo>()
        collectColumnPaths({question: "Q"}, "inputs", results, 1)
        expect(results.get("inputs.question")).toEqual({
            parentKey: "inputs",
            path: ["inputs", "question"],
        })
    })
})
