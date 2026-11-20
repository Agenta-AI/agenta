/**
 * The value of one entry of the "Secret" select. A project secret is named by its slug, a
 * person's own secret by its id, so the two lists cannot clash.
 */
export const NEW_SECRET = "__new__"

const PROJECT = "project:"
const OWN = "own:"

export type SecretChoice =
    | {kind: "none"}
    | {kind: "new"}
    | {kind: "project"; slug: string}
    | {kind: "own"; secretId: string}

export const projectSecretValue = (slug: string) => `${PROJECT}${slug}`
export const ownSecretValue = (secretId: string) => `${OWN}${secretId}`

export const readSecretChoice = (value: string): SecretChoice => {
    if (value === NEW_SECRET) return {kind: "new"}
    if (value.startsWith(PROJECT) && value.length > PROJECT.length)
        return {kind: "project", slug: value.slice(PROJECT.length)}
    if (value.startsWith(OWN) && value.length > OWN.length)
        return {kind: "own", secretId: value.slice(OWN.length)}
    return {kind: "none"}
}
