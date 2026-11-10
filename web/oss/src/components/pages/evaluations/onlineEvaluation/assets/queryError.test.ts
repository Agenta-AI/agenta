import {describe, expect, it} from "vitest"

import {
    CREATE_FAILED_MESSAGE,
    queryCreateErrorMessage,
    TRACE_FILTERS_NOT_SAVED_MESSAGE,
} from "./queryError"

const httpError = (status: number, detail?: unknown) => ({
    response: {status, data: detail === undefined ? {} : {detail}},
})

describe("queryCreateErrorMessage", () => {
    it("shows the filter message for a filter validation answer", () => {
        expect(
            queryCreateErrorMessage(
                httpError(400, "'is_annotation' needs an evaluator or a feedback."),
            ),
        ).toBe(TRACE_FILTERS_NOT_SAVED_MESSAGE)
        expect(
            queryCreateErrorMessage(httpError(422, [{loc: ["body"], msg: "field required"}])),
        ).toBe(TRACE_FILTERS_NOT_SAVED_MESSAGE)
    })

    it("shows the generic create-failure text for any other failure", () => {
        expect(queryCreateErrorMessage(new Error("Network Error"))).toBe(CREATE_FAILED_MESSAGE)
        expect(queryCreateErrorMessage(httpError(403, "Forbidden"))).toBe(CREATE_FAILED_MESSAGE)
        expect(queryCreateErrorMessage(httpError(500, "boom"))).toBe(CREATE_FAILED_MESSAGE)
        expect(queryCreateErrorMessage(httpError(400))).toBe(CREATE_FAILED_MESSAGE)
        expect(queryCreateErrorMessage(undefined)).toBe(CREATE_FAILED_MESSAGE)
    })
})
