/**
 * The Permissions selector's sub-lines. One option says "default", and it has to be the policy a
 * new agent really gets — `allow` since #6641, while the dropdown still credited `allow_reads`
 * (#6662). The copy lives in one list, so pin the claim here rather than in each host's render.
 */
import {describe, expect, it} from "vitest"

import {
    DEFAULT_PERMISSION_POLICY,
    PERMISSION_POLICY_OPTIONS,
    permissionPolicyOptionsForEnum,
} from "../../src/utils/permissionPolicy"

/** What the SDK writes into a new agent template (`sdks/python/agenta/sdk/utils/types.py`). */
const NEW_AGENT_POLICY = "allow"

const claimsDefault = (help: string) => /\bdefault\b/i.test(help)

describe("permission policy option copy", () => {
    it("marks exactly one option as the default", () => {
        const marked = PERMISSION_POLICY_OPTIONS.filter((option) => claimsDefault(option.help))
        expect(marked.map((option) => option.value)).toEqual([NEW_AGENT_POLICY])
    })

    it("does not call Allow reads the default any more (#6662)", () => {
        const allowReads = PERMISSION_POLICY_OPTIONS.find(
            (option) => option.value === "allow_reads",
        )
        expect(allowReads?.help).toBe("Reads run, writes ask")
    })

    it("keeps the runner's missing-policy fallback separate from the new-agent default", () => {
        // #6641 changed what a new template names and deliberately left the fallback alone, so
        // these two are allowed to differ. The test exists to make a change to either deliberate.
        expect(DEFAULT_PERMISSION_POLICY).toBe("allow_reads")
        expect(DEFAULT_PERMISSION_POLICY).not.toBe(NEW_AGENT_POLICY)
    })

    it("keeps the default marker on a schema that narrows the options", () => {
        const narrowed = permissionPolicyOptionsForEnum(["allow", "ask"])
        expect(narrowed.filter((option) => claimsDefault(option.help))).toHaveLength(1)
    })

    it("gives every option a label and a sub-line", () => {
        for (const option of PERMISSION_POLICY_OPTIONS) {
            expect(option.label).toBeTruthy()
            expect(option.help).toBeTruthy()
        }
    })
})
