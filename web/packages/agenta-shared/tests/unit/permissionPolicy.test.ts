/** No option claims to be the default, because "the default" is two policies here (#6662). */
import {describe, expect, it} from "vitest"

import {
    DEFAULT_PERMISSION_POLICY,
    PERMISSION_POLICY_OPTIONS,
} from "../../src/utils/permissionPolicy"

describe("permission policy option copy", () => {
    it("does not call any option the default (#6662)", () => {
        for (const option of PERMISSION_POLICY_OPTIONS) {
            expect(`${option.label} ${option.help}`, option.value).not.toMatch(/\bdefaults?\b/i)
        }
    })

    it("gives every option a label and a sub-line", () => {
        for (const option of PERMISSION_POLICY_OPTIONS) {
            expect(option.label).toBeTruthy()
            expect(option.help).toBeTruthy()
        }
    })

    it("still falls back to Allow reads for a config that names no policy", () => {
        // Unchanged by #6641 and unchanged here. Both selectors show this as the applied value.
        expect(DEFAULT_PERMISSION_POLICY).toBe("allow_reads")
    })
})
