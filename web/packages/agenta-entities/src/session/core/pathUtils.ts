/**
 * Slash trimming via a single linear scan — NOT the `/^\/+|\/+$/` regex. A quantifier anchored at
 * the end (`\/+$`) backtracks quadratically on a path with many '/' that doesn't end in one, which
 * CodeQL flags as a polynomial-ReDoS on the backend-supplied (uncontrolled) mount paths. Internal
 * slashes are preserved. `47` is `"/".charCodeAt(0)`.
 */
const SLASH = 47

export const stripLeadingSlashes = (s: string): string => {
    let i = 0
    while (i < s.length && s.charCodeAt(i) === SLASH) i++
    return i === 0 ? s : s.slice(i)
}

export const stripTrailingSlashes = (s: string): string => {
    let end = s.length
    while (end > 0 && s.charCodeAt(end - 1) === SLASH) end--
    return end === s.length ? s : s.slice(0, end)
}

/** Strip leading AND trailing slashes (equivalent to `.replace(/^\/+|\/+$/g, "")`, ReDoS-safe). */
export const trimSlashes = (s: string): string => stripTrailingSlashes(stripLeadingSlashes(s))
