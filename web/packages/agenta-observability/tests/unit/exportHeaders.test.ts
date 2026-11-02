import {describe, expect, it} from "vitest"

import {createTraceObject, DEFAULT_TRACE_EXPORT_HEADERS} from "../../src/etl/exportUtils"

/**
 * The CSV writer feeds Papa `{fields: headers, data: rows}`, and Papa reads `row[field]` for
 * each header. So the header list and the row mapper are one contract: a header the mapper
 * cannot fill writes an empty column, and a key the headers omit is dropped silently.
 *
 * This pins that contract. It is what caught the "Evaluators" column shipping empty.
 */
describe("trace CSV export contract", () => {
    it("emits exactly the keys the default headers promise", () => {
        const row = createTraceObject({
            span_id: "s1",
            trace_id: "t1",
            span_name: "span",
            status_code: "STATUS_CODE_OK",
        } as never)

        expect(Object.keys(row).sort()).toEqual([...DEFAULT_TRACE_EXPORT_HEADERS].sort())
    })

    it("fills every promised header, so no column is silently blank", () => {
        const row = createTraceObject({
            span_id: "s1",
            trace_id: "t1",
            span_name: "span",
            status_code: "STATUS_CODE_OK",
        } as never) as Record<string, unknown>

        for (const header of DEFAULT_TRACE_EXPORT_HEADERS) {
            expect(row, `"${header}" has no value in the exported row`).toHaveProperty(header)
        }
    })
})
