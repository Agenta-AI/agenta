import {describe, expect, it} from "vitest"

import {howStepText, type HowStep} from "../../src/features/marketplace/marketplaceView"

const connection = (role: string): HowStep => ({
    kind: "connection",
    number: 1,
    role,
    app: {slug: "github", name: "GitHub"} as never,
    optional: false,
})

describe("howStepText", () => {
    it("closes a role that has no period", () => {
        expect(howStepText(connection("Read the code"))).toBe("Read the code.")
    })

    it("keeps a role that already ends a sentence", () => {
        expect(howStepText(connection("Find keywords and search opportunities."))).toBe(
            "Find keywords and search opportunities.",
        )
        expect(howStepText(connection("Ready to post? "))).toBe("Ready to post?")
    })

    it("shows a trigger's text as written", () => {
        expect(howStepText({kind: "trigger", text: "Every Monday at 9:00"})).toBe(
            "Every Monday at 9:00",
        )
    })
})
