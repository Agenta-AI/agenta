// `crypto.randomUUID` needs a secure context; over plain HTTP it is undefined and the unguarded
// call threw during render, blanking the screen.

const HEX = Array.from({length: 256}, (_, i) => i.toString(16).padStart(2, "0"))

/** Fallback counter, so the no-crypto id claims sequence rather than randomness. */
let sequence = 0

const cryptoApi = (): Crypto | undefined => (typeof crypto === "undefined" ? undefined : crypto)

/** RFC 4122 v4 from real entropy — insecure contexts still have `getRandomValues`. */
function uuidFromRandomValues(api: Crypto): string {
    const bytes = api.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx
    const hex = Array.from(bytes, (byte) => HEX[byte])
    return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join(""),
    ].join("-")
}

/** A client-minted session id or React key. Never security-bearing. */
export function newId(): string {
    const api = cryptoApi()
    if (api) {
        if (typeof api.randomUUID === "function") return api.randomUUID()
        if (typeof api.getRandomValues === "function") return uuidFromRandomValues(api)
    }
    // No crypto at all: unique within the tab, and honest about carrying no entropy.
    sequence += 1
    return `id-${Date.now().toString(36)}-${sequence.toString(36)}`
}
