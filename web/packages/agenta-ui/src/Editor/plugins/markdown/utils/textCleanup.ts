function isTemplateEscapableChar(char: string): boolean {
    switch (char) {
        case "\\":
        case "`":
        case "*":
        case "{":
        case "}":
        case "[":
        case "]":
        case "(":
        case ")":
        case "#":
        case "+":
        case "-":
        case ".":
        case "!":
        case "_":
        case ">":
            return true
        default:
            return false
    }
}

function unescapeTemplateSegment(segment: string): string {
    const firstEscapeIndex = segment.indexOf("\\")
    if (firstEscapeIndex === -1) {
        return segment
    }

    const parts: string[] = []
    let lastSliceStart = 0

    for (let i = firstEscapeIndex; i < segment.length; i += 1) {
        if (segment.charCodeAt(i) !== 92 || i + 1 >= segment.length) {
            continue
        }

        const nextChar = segment[i + 1]
        if (!isTemplateEscapableChar(nextChar)) {
            continue
        }

        if (lastSliceStart < i) {
            parts.push(segment.slice(lastSliceStart, i))
        }

        parts.push(nextChar)
        i += 1
        lastSliceStart = i + 1
    }

    if (parts.length === 0) {
        return segment
    }

    if (lastSliceStart < segment.length) {
        parts.push(segment.slice(lastSliceStart))
    }

    return parts.join("")
}

export function unescapeTemplateDelimiters(markdown: string): string {
    const firstDelimiterIndex = markdown.indexOf("{")
    if (firstDelimiterIndex === -1) {
        return markdown
    }

    const parts: string[] = []
    let cursor = 0

    while (cursor < markdown.length) {
        const openIndex = markdown.indexOf("{", cursor)

        if (openIndex === -1) {
            parts.push(markdown.slice(cursor))
            break
        }

        if (openIndex > cursor) {
            parts.push(markdown.slice(cursor, openIndex))
        }

        const nextChar = markdown[openIndex + 1]

        if (nextChar === "{") {
            const closeIndex = markdown.indexOf("}}", openIndex + 2)
            if (closeIndex === -1) {
                parts.push(markdown.slice(openIndex))
                break
            }

            const content = markdown.slice(openIndex + 2, closeIndex)
            parts.push(`{{${unescapeTemplateSegment(content)}}}`)
            cursor = closeIndex + 2
            continue
        }

        if (nextChar === "%") {
            const closeIndex = markdown.indexOf("%}", openIndex + 2)
            if (closeIndex === -1) {
                parts.push(markdown.slice(openIndex))
                break
            }

            let content = markdown.slice(openIndex + 2, closeIndex)
            let trimLeft = ""
            let trimRight = ""

            if (content.startsWith("-")) {
                trimLeft = "-"
                content = content.slice(1)
            }

            if (content.endsWith("-")) {
                trimRight = "-"
                content = content.slice(0, -1)
            }

            parts.push(`{%${trimLeft}${unescapeTemplateSegment(content)}${trimRight}%}`)
            cursor = closeIndex + 2
            continue
        }

        if (nextChar === "#") {
            const closeIndex = markdown.indexOf("#}", openIndex + 2)
            if (closeIndex === -1) {
                parts.push(markdown.slice(openIndex))
                break
            }

            const content = markdown.slice(openIndex + 2, closeIndex)
            parts.push(`{#${unescapeTemplateSegment(content)}#}`)
            cursor = closeIndex + 2
            continue
        }

        parts.push("{")
        cursor = openIndex + 1
    }

    return parts.join("")
}

export function stripBackslashEscapes(value: string): string {
    const firstEscapeIndex = value.indexOf("\\")
    if (firstEscapeIndex === -1) {
        return value
    }

    const parts: string[] = []
    let lastSliceStart = 0

    for (let i = firstEscapeIndex; i < value.length; i += 1) {
        if (value.charCodeAt(i) !== 92 || i + 1 >= value.length) {
            continue
        }

        if (lastSliceStart < i) {
            parts.push(value.slice(lastSliceStart, i))
        }

        parts.push(value[i + 1])
        i += 1
        lastSliceStart = i + 1
    }

    if (parts.length === 0) {
        return value
    }

    if (lastSliceStart < value.length) {
        parts.push(value.slice(lastSliceStart))
    }

    return parts.join("")
}
