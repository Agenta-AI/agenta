// Pure utility version for robust partial JSON parsing

import {jsonrepair} from "jsonrepair"

import {createLogger} from "./utils/createLogger"

/**
 * Attempts to parse a string containing partial or malformed JSON and extract all valid key-value pairs.
 *
 * This function is designed to be robust against incomplete, malformed, or user-edited JSON,
 * such as those encountered in live editors where users may leave trailing commas, missing values, or
 * incomplete structures. It recovers as many valid pairs as possible, skipping invalid or incomplete ones.
 *
 * Supported features:
 * - Ignores incomplete key-value pairs, missing colons, or values.
 * - Handles nested objects and arrays.
 * - Recovers from missing commas and trailing pairs.
 * - Returns an object containing only valid pairs, or null if none found or input is invalid.
 *
 * @param input - The JSON string or object to parse. If an object is given, it is returned as-is.
 * @returns An object containing all valid key-value pairs, or null if none are found or input is invalid.
 *
 * Example:
 *   tryParsePartialJson('{"a": 1, "b": }') // returns { a: 1 }
 *   tryParsePartialJson('{"a": 1, "b": 2, "": 3}') // returns { a: 1, b: 2 }
 */
const log = createLogger("tryParsePartialJson", {
    disabled: true,
})

export function tryParsePartialJson(input: any): any | null {
    // If input is already an object, return it directly
    if (typeof input !== "string") {
        if (typeof input === "object" && input !== null) {
            return input
        }
        return null
    }

    // Clean invisibles only. Use jsonrepair for tolerant fixes (quote delimiters,
    // trailing commas, etc.) while preserving Unicode inside string contents.
    const removeInvisibles = (str: string) => str.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    const cleanedInput = removeInvisibles(input)

    // FIRST: Try standard JSON.parse to preserve original key ordering
    try {
        const parsed = JSON.parse(cleanedInput.trim())
        log(
            "[tryParsePartialJson] Successfully parsed with standard JSON.parse, preserving key order",
        )
        return parsed
    } catch (e) {
        log("[tryParsePartialJson] Standard JSON.parse failed, trying common fixes:", e.message)
    }

    // Try jsonrepair to broadly fix malformed JSON while preserving content
    try {
        const repaired = jsonrepair(cleanedInput.trim())
        const parsed = JSON.parse(repaired)
        log("[tryParsePartialJson] Successfully parsed after jsonrepair")
        return parsed
    } catch (e) {
        log("[tryParsePartialJson] jsonrepair parse failed, falling back to heuristics:", e.message)
    }

    // SECOND: Try fixing common JSON issues before falling back to manual parsing
    const commonFixes = [
        // Remove trailing commas (most common issue)
        (str: string) => str.replace(/,\s*([}\]])/g, "$1"),
        // Remove trailing comma at end of object/array
        (str: string) => str.replace(/,\s*$/, ""),
        // Fix missing quotes around keys (basic case)
        (str: string) => str.replace(/(\w+)\s*:/g, '"$1":'),
    ]

    for (const fix of commonFixes) {
        try {
            const fixedInput = fix(cleanedInput.trim())
            const parsed = JSON.parse(fixedInput)
            log(
                "[tryParsePartialJson] Successfully parsed after applying common fixes, preserving key order",
            )
            return parsed
        } catch (e) {
            // Continue to next fix
            log("[tryParsePartialJson] Fix attempt failed:", e.message)
        }
    }

    // Remove outer braces if present for easier parsing, so we can focus on key-value pairs
    let body = cleanedInput.trim()
    if (body.startsWith("{") && body.endsWith("}")) {
        body = body.slice(1, -1)
    }

    /**
     * Helper: Attempts to parse a value (string, object, array, literal) from a given position.
     * Returns a tuple [valueString, nextIndex] or null if incomplete.
     *
     * Handles:
     * - Strings (including escaped quotes)
     * - Objects (nested braces)
     * - Arrays (nested brackets)
     * - Literals (true, false, null, numbers)
     */
    function parseValue(str: string, start: number): [any, number] | null {
        let i = start
        // Skip whitespace
        while (str[i] === " " || str[i] === "\n" || str[i] === "\t") i++
        if (str[i] === '"') {
            // Parse quoted string value, handling escaped quotes
            let end = i + 1
            let escaped = false
            while (end < str.length) {
                if (!escaped && str[end] === '"') break
                if (str[end] === "\\") escaped = !escaped
                else escaped = false
                end++
            }
            if (end < str.length && str[end] === '"') {
                return [str.slice(i, end + 1), end + 1]
            }
            // If string is incomplete, return null
            return null // incomplete string
        }
        // Parse object
        if (str[i] === "{") {
            // Parse nested object value by tracking brace depth
            let depth = 1,
                end = i + 1
            while (end < str.length && depth > 0) {
                if (str[end] === "{") depth++
                if (str[end] === "}") depth--
                end++
            }
            if (depth === 0) {
                return [str.slice(i, end), end]
            }
            return null // incomplete object
        }
        // Parse array
        if (str[i] === "[") {
            // Parse array value by tracking bracket depth
            let depth = 1,
                end = i + 1
            while (end < str.length && depth > 0) {
                if (str[end] === "[") depth++
                if (str[end] === "]") depth--
                end++
            }
            if (depth === 0) {
                return [str.slice(i, end), end]
            }
            return null // incomplete array
        }
        // Parse literal (true, false, null, number)
        // Parse literal: true, false, null, or number
        const litMatch = /^(true|false|null|-?\d+(?:\.\d+)?)/.exec(str.slice(i))
        if (litMatch) {
            return [litMatch[1], i + litMatch[1].length]
        }
        // If nothing matches, return null
        return null
    }

    // --- Main Parsing Loop ---
    // Iterates through the input, extracting valid key-value pairs and skipping invalid/incomplete ones.
    const result: string[] = []
    let i = 0
    while (i < body.length) {
        // Skip whitespace and commas
        while (
            i < body.length &&
            (body[i] === "," || body[i] === " " || body[i] === "\n" || body[i] === "\t")
        )
            i++
        if (i >= body.length) break
        // Parse key
        // If the current character is not a quote, it's not a valid key start; skip to next candidate
        /*
         * Key Detection:
         * If the current character is not a quote, it's not a valid key start.
         * The parser skips ahead to the next comma or quote, ensuring it doesn't get stuck on malformed input.
         */
        if (body[i] !== '"') {
            log(`[tryParsePartialJson] Skipping non-key at i=${i}, char='${body[i]}'`)
            // Skip to next comma or quote, or break if none found
            let foundNext = false
            while (i < body.length) {
                if (body[i] === "," || body[i] === '"') {
                    foundNext = true
                    break
                }
                i++
            }
            if (!foundNext) break
            // If we landed on a quote, do not increment i, so next loop parses it as a key
            if (body[i] === '"') {
                continue
            }
            // Otherwise, if it's a comma, increment i to move past it
            if (body[i] === ",") {
                i++
            }
            continue
        }
        // Parse the key (quoted string), handling escaped quotes
        /*
         * Key Parsing:
         * Looks for the end of the quoted key, handling escaped quotes.
         * If the closing quote is not found, the key is incomplete and will be skipped.
         */
        let keyEnd = i + 1
        let escaped = false
        while (keyEnd < body.length) {
            if (!escaped && body[keyEnd] === '"') break
            if (body[keyEnd] === "\\") escaped = !escaped
            else escaped = false
            keyEnd++
        }
        // If we couldn't find a closing quote, skip this incomplete key
        if (keyEnd >= body.length || body[keyEnd] !== '"') {
            log(`[tryParsePartialJson] Incomplete key at i=${i}, keyEnd=${keyEnd}`)
            // Skip to next comma or quote, or break if none found
            let foundNext = false
            while (i < body.length) {
                if (body[i] === "," || body[i] === '"') {
                    foundNext = true
                    break
                }
                i++
            }
            if (!foundNext) break
            if (body[i] === '"') {
                continue
            }
            if (body[i] === ",") {
                i++
            }
            continue
        }
        const key = body.slice(i, keyEnd + 1)
        log(`[tryParsePartialJson] Found key: ${key} at i=${i}`)
        // Skip empty string keys ("")
        /*
         * Empty Key Handling:
         * If the key is an empty string (""), it is skipped.
         * The parser advances to the next plausible key/value boundary.
         */
        if (key === '""') {
            log(`[tryParsePartialJson] Skipping empty key at i=${i}`)
            i = keyEnd + 1
            // Skip to next comma or quote, or break if none found
            let foundNext = false
            while (i < body.length) {
                if (body[i] === "," || body[i] === '"') {
                    foundNext = true
                    break
                }
                i++
            }
            if (!foundNext) break
            if (body[i] === '"') {
                continue
            }
            if (body[i] === ",") {
                i++
            }
            continue
        }
        i = keyEnd + 1
        // Skip whitespace after key
        while (i < body.length && (body[i] === " " || body[i] === "\n" || body[i] === "\t")) i++
        // Expect colon after key
        /*
         * Colon Expectation:
         * After a key, a colon is expected. If not found, this is a malformed pair.
         * The parser skips to the next comma or quote to recover.
         */
        if (body[i] !== ":") {
            log(`[tryParsePartialJson] Missing colon after key at i=${i}, char='${body[i]}'`)
            // Skip to next comma or quote, or break if none found
            let foundNext = false
            while (i < body.length) {
                if (body[i] === "," || body[i] === '"') {
                    foundNext = true
                    break
                }
                i++
            }
            if (!foundNext) break
            if (body[i] === '"') {
                continue
            }
            if (body[i] === ",") {
                i++
            }
            continue
        }
        i++ // skip colon
        // Skip whitespace after colon
        while (i < body.length && (body[i] === " " || body[i] === "\n" || body[i] === "\t")) i++
        // Defensive: If the next character is a quote and what follows is a new key (quoted string + colon),
        // treat the previous key as incomplete and skip it.
        if (body[i] === '"') {
            let lookahead = i + 1
            let escaped = false
            while (lookahead < body.length) {
                if (!escaped && body[lookahead] === '"') break
                if (body[lookahead] === "\\") escaped = !escaped
                else escaped = false
                lookahead++
            }
            // lookahead now points to closing quote
            let afterQuote = lookahead + 1
            while (
                afterQuote < body.length &&
                (body[afterQuote] === " " || body[afterQuote] === "\n" || body[afterQuote] === "\t")
            )
                afterQuote++
            if (body[afterQuote] === ":") {
                // This is a new key, so skip current key as incomplete value
                // Skip to next comma or quote, or break if none found
                let foundNext = false
                while (i < body.length) {
                    if (body[i] === "," || body[i] === '"') {
                        foundNext = true
                        break
                    }
                    i++
                }
                if (!foundNext) break
                if (body[i] === '"') {
                    continue
                }
                if (body[i] === ",") {
                    i++
                }
                continue
            }
        }
        // Parse value for the key
        /*
         * Value Parsing:
         * Attempts to parse a value (string, object, array, literal) using the helper.
         * If successful, the value is validated and added to the result set.
         * If not, the parser skips to the next plausible boundary.
         */
        const valueParsed = parseValue(body, i)
        if (valueParsed) {
            const [valueStr, nextIdx] = valueParsed
            log(`[tryParsePartialJson] Found value: ${valueStr} for key ${key} at i=${i}`)
            // Check if value itself is a valid JSON
            try {
                const parsedValue = JSON.parse(valueStr)
                // Stringify value correctly (e.g. numbers, booleans, null without quotes)
                result.push(
                    `${key}: ${typeof parsedValue === "string" ? JSON.stringify(parsedValue) : valueStr}`,
                )
                log(`[tryParsePartialJson] Added pair: ${key}: ${valueStr}`)
            } catch (e) {
                log(`[tryParsePartialJson] Invalid value for key ${key}: ${valueStr}`)
                // skip invalid value
            }
            // Advance i to next key or end of string after a valid pair
            i = nextIdx
            while (i < body.length && (body[i] === " " || body[i] === "\n" || body[i] === "\t")) i++
            // If the next character is a comma, skip it
            if (i < body.length && body[i] === ",") {
                i++
            } else if (i < body.length && body[i] !== '"') {
                // If not a comma or a quote (next key), check if it's the end; if not, break
                // This handles the case where input ends after a valid pair without a comma
                break
            }
            // Otherwise, loop will handle non-key chars
        } else {
            /*
             * Incomplete or Missing Value Recovery:
             * If a value could not be parsed, the parser skips ahead to the next comma or quote,
             * ensuring it does not get stuck on malformed or trailing pairs.
             */
            log(`[tryParsePartialJson] Incomplete value after key at i=${i}`)
            // Skip to next comma or quote, or break if none found
            let foundNext = false
            while (i < body.length) {
                if (body[i] === "," || body[i] === '"') {
                    foundNext = true
                    break
                }
                i++
            }
            if (!foundNext) break
            if (body[i] === '"') {
                continue
            }
            if (body[i] === ",") {
                i++
            }
            continue
        }
    }

    // --- Finalization ---
    // Always try to return valid pairs, even if incomplete pairs were encountered
    const filteredResult = result.filter(Boolean)
    log("[tryParsePartialJson] Filtered result array:", filteredResult)
    if (filteredResult.length > 0) {
        try {
            // Reconstruct a valid JSON string from valid pairs
            const jsonString = `{${filteredResult.join(",")}}`
            log("[tryParsePartialJson] Final constructed string:", jsonString)
            const parsed = JSON.parse(jsonString)
            log("[tryParsePartialJson] Parsed result:", parsed)
            return parsed
        } catch (e) {
            // If the reconstructed string is invalid, return null
            log("[tryParsePartialJson] Final parse error:", e, "String was:", jsonString)
            return null
        }
    }
    // If no valid pairs found, return null
    return null
}
