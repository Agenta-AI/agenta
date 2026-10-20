/** The visitor key is the widget's only credential; the server checks this same rule. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
const MIN_DISTINCT_CHARACTERS = 12

export const isValidVisitorKey = (key: unknown): key is string =>
    typeof key === "string" && KEY_PATTERN.test(key) && new Set(key).size >= MIN_DISTINCT_CHARACTERS

const base64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export const createVisitorKey = (): string => {
    for (;;) {
        const key = base64url(crypto.getRandomValues(new Uint8Array(32)))
        // A random key fails the distinct-character rule with negligible odds; never send one.
        if (isValidVisitorKey(key)) return key
    }
}

/** This browser's own key for the embed; it lasts only for the page when storage is blocked. */
export const anonymousVisitorKey = (embedId: string, storage: Storage | null): string => {
    const name = `agenta-embed:${embedId}`
    try {
        const stored = storage?.getItem(name)
        if (isValidVisitorKey(stored)) return stored
    } catch {
        // Storage that throws on read is treated as empty.
    }
    const key = createVisitorKey()
    try {
        storage?.setItem(name, key)
    } catch {
        // Not stored: the conversation history lasts only for this page.
    }
    return key
}
