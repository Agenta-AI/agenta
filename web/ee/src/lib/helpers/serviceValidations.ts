const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MONGO_OBJECT_ID_RE = /^[0-9a-f]{24}$/i

export function isValidId(id: unknown): id is string {
    if (typeof id !== "string") return false
    const s = id.trim()
    if (!s) return false
    if (s.includes("/") || s.includes("\\") || s.includes("..")) return false
    return UUID_RE.test(s) || MONGO_OBJECT_ID_RE.test(s)
}

export function assertValidId(id: unknown, label = "id"): string {
    if (!isValidId(id)) {
        throw new TypeError(`Invalid ${label}: must be a UUID or 24-hex ObjectId`)
    }
    return (id as string).trim()
}
