import {loadLanguage} from "@agenta/i18n"
import {beforeAll, describe, expect, it} from "vitest"

import {plainAccessError} from "../../src/features/settings/accessErrors"

// The English catalogs load with import(); read them before the first call.
beforeAll(() => loadLanguage("en"))

describe("plainAccessError", () => {
    it("never returns the server text", () => {
        expect(plainAccessError(new Error("psycopg2 duplicate key"), "Could not save")).toBe(
            "Could not save",
        )
        expect(
            plainAccessError({body: {detail: "secret leak"}, statusCode: 500}, "Could not save"),
        ).toBe("Could not save")
    })

    it("maps permission and conflict statuses", () => {
        expect(plainAccessError({statusCode: 403}, "x")).toBe(
            "You do not have permission to do that.",
        )
        expect(plainAccessError({response: {status: 409}}, "x")).toContain("already exists")
    })
})
