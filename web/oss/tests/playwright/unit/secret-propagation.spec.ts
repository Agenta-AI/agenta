import {expect, test} from "@playwright/test"

import {isSecretPropagationFailure} from "../acceptance/playground/assets/secretPropagation"

test("retries a stale named connection inventory without masking ordinary run errors", () => {
    expect(
        isSecretPropagationFailure({
            status: {
                code: 400,
                type: "https://agenta.ai/docs/misc/errors#v0:schemas:unknown-connection",
                message: "No provider connection named 'replacement'. Known connections: previous.",
            },
        }),
    ).toBe(true)
    expect(isSecretPropagationFailure({status: {code: 500, message: "unknown-connection"}})).toBe(
        false,
    )
    expect(
        isSecretPropagationFailure({status: {code: 400, type: "other:unknown-connection"}}),
    ).toBe(false)
    expect(isSecretPropagationFailure({status: {code: 429, message: "Rate limit exceeded"}})).toBe(
        false,
    )
    expect(isSecretPropagationFailure({status: {code: 200}, data: "unknown-connection"})).toBe(
        false,
    )
    expect(isSecretPropagationFailure(null)).toBe(false)
    expect(isSecretPropagationFailure({status: {type: "#v0:schemas:invalid-secrets"}})).toBe(true)
    expect(isSecretPropagationFailure({status: {message: "No API key found for model"}})).toBe(true)
})
