/**
 * The shape check the email-first step applies before it asks the backend anything.
 *
 * It replaces `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which accepts the same addresses but scans them in
 * quadratic time: the `.`-separated domain parts overlap, so a long non-matching address made of
 * many `!.` groups makes the engine retry every split point. This version walks the string a fixed
 * number of times, so the cost is linear in the length of the input.
 *
 * Accepted, exactly as before: a non-empty local part, one `@`, and a domain that carries a `.`
 * which is neither its first nor its last character. No whitespace anywhere.
 */
export const isValidEmailAddress = (value: string): boolean => {
    const at = value.indexOf("@")
    // A local part of at least one character.
    if (at < 1) return false
    const domain = value.slice(at + 1)
    // The domain may not carry a second `@`.
    if (domain.includes("@")) return false
    if (/\s/.test(value)) return false
    // A `.` inside the domain, with at least one character on each side of it.
    const dot = domain.indexOf(".", 1)
    return dot > 0 && dot < domain.length - 1
}
