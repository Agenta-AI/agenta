/**
 * The value of one entry of the "Secret" select. A shared secret (the project's, or an
 * organization's the project may use) is named by its slug, a person's own secret by its id, so
 * the two lists cannot clash.
 */
export const NEW_SECRET = "__new__"

const SHARED = "shared:"
const USER = "user:"

export type SecretChoice =
    | {kind: "none"}
    | {kind: "new"}
    | {kind: "shared"; slug: string}
    | {kind: "user"; secretId: string}

export const sharedSecretValue = (slug: string) => `${SHARED}${slug}`
export const userSecretValue = (secretId: string) => `${USER}${secretId}`

export const readSecretChoice = (value: string): SecretChoice => {
    if (value === NEW_SECRET) return {kind: "new"}
    if (value.startsWith(SHARED) && value.length > SHARED.length)
        return {kind: "shared", slug: value.slice(SHARED.length)}
    if (value.startsWith(USER) && value.length > USER.length)
        return {kind: "user", secretId: value.slice(USER.length)}
    return {kind: "none"}
}
