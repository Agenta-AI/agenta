import {STATUS_TONE_TEXT_COLOR} from "@agenta/ui/components/presentational"
import {describe, expect, it} from "vitest"

import {
    RUN_STATUS_DOT_COLOR,
    RUN_STATUS_TEXT_COLOR,
} from "@/features/evaluations/list/runStatusDotColor"

describe("run status colors", () => {
    it("gives each tone one text color, the shared status color, next to its dot color", () => {
        expect(RUN_STATUS_TEXT_COLOR).toBe(STATUS_TONE_TEXT_COLOR)
        expect(RUN_STATUS_TEXT_COLOR).toEqual({
            success: "text-success",
            warning: "text-warning",
            error: "text-destructive",
            processing: "text-info",
            default: "text-muted-foreground",
        })
        expect(Object.keys(RUN_STATUS_TEXT_COLOR).sort()).toEqual(
            Object.keys(RUN_STATUS_DOT_COLOR).sort(),
        )
    })
})
