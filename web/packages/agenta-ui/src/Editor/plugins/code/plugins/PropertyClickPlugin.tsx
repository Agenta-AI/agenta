/**
 * PropertyClickPlugin
 *
 * Enables clicking on JSON property keys to trigger navigation.
 * When a user clicks on a property key in the JSON editor,
 * this plugin extracts the full JSON path and calls the onPropertyClick callback.
 */
import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

interface PropertyClickPluginProps {
    /** Callback when a property key is clicked - receives the full JSON path */
    onPropertyClick?: (path: string) => void
    /** Language of the code (only 'json' is supported) */
    language?: string
}

/**
 * Calculate the full JSON path to a property by parsing the editor content
 * and tracking the nesting structure up to the clicked property.
 * Handles both object keys and array indices.
 */
function calculateJsonPath(rootElement: HTMLElement, targetElement: HTMLElement): string | null {
    // Find the position of the target in the text
    const range = document.createRange()
    range.setStartBefore(rootElement.firstChild || rootElement)
    range.setEndBefore(targetElement)
    const textBefore = range.toString()

    // Stack to track context at each nesting level
    // Each entry: { type: 'object' | 'array', key?: string, index: number }
    const stack: {type: "object" | "array"; key?: string; index: number}[] = []
    let inString = false
    let currentKey = ""
    let collectingKey = false
    let i = 0

    while (i < textBefore.length) {
        const char = textBefore[i]

        // Handle string boundaries
        if (char === '"' && (i === 0 || textBefore[i - 1] !== "\\")) {
            if (!inString) {
                inString = true
                collectingKey = true
                currentKey = ""
            } else {
                inString = false
                if (collectingKey && currentKey) {
                    // Check if this is followed by a colon (making it a key)
                    const afterQuote = textBefore.slice(i + 1).trimStart()
                    if (afterQuote.startsWith(":") && stack.length > 0) {
                        // This is a key in the current object
                        stack[stack.length - 1].key = currentKey
                    }
                }
                collectingKey = false
            }
            i++
            continue
        }

        if (inString) {
            if (collectingKey) {
                currentKey += char
            }
            i++
            continue
        }

        // Track nesting
        if (char === "{") {
            stack.push({type: "object", index: 0})
        } else if (char === "[") {
            stack.push({type: "array", index: 0})
        } else if (char === "}" || char === "]") {
            stack.pop()
        } else if (char === ",") {
            // Increment array index when we see a comma at array level
            if (stack.length > 0 && stack[stack.length - 1].type === "array") {
                stack[stack.length - 1].index++
            }
        }

        i++
    }

    // Build the path from the stack
    // Don't include the key from the innermost object frame - the clicked key replaces it
    const path: string[] = []
    for (let j = 0; j < stack.length; j++) {
        const frame = stack[j]
        const isLast = j === stack.length - 1

        if (frame.type === "array") {
            path.push(String(frame.index))
        } else if (frame.type === "object" && frame.key && !isLast) {
            // Only include keys from non-innermost object frames
            path.push(frame.key)
        }
    }

    // Get the clicked property key
    const propertyText = targetElement.textContent || ""
    const clickedKey = propertyText.replace(/^"|"$/g, "")

    if (!clickedKey) return null

    // Add the clicked key to the path
    path.push(clickedKey)

    return path.join(".")
}

export default function PropertyClickPlugin({
    onPropertyClick,
    language = "json",
}: PropertyClickPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        if (!onPropertyClick || language !== "json") return

        const rootElement = editor.getRootElement()
        if (!rootElement) return

        // Add tooltip on hover
        const handleMouseEnter = (event: MouseEvent) => {
            const target = event.target as HTMLElement
            if (!target.classList.contains("token-property")) return

            const fullPath = calculateJsonPath(rootElement, target)
            if (fullPath) {
                target.setAttribute("title", `Click to drill into "${fullPath}"`)
            }
        }

        const handleMouseLeave = (event: MouseEvent) => {
            const target = event.target as HTMLElement
            if (target.classList.contains("token-property")) {
                target.removeAttribute("title")
            }
        }

        const handleClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement

            // Check if clicked on a property token
            if (!target.classList.contains("token-property")) return

            const fullPath = calculateJsonPath(rootElement, target)
            if (!fullPath) return

            // Prevent default behavior
            event.preventDefault()
            event.stopPropagation()

            onPropertyClick(fullPath)
        }

        // Handle custom drill-in event from LongTextNode popover
        const handleLongTextDrillIn = (event: Event) => {
            console.log("[PropertyClickPlugin] handleLongTextDrillIn called", event)
            const customEvent = event as CustomEvent<{propertyElement: HTMLElement}>
            const propertyElement = customEvent.detail?.propertyElement
            console.log("[PropertyClickPlugin] propertyElement:", propertyElement)
            if (!propertyElement) {
                console.log("[PropertyClickPlugin] No propertyElement in event detail")
                return
            }

            const fullPath = calculateJsonPath(rootElement, propertyElement)
            console.log("[PropertyClickPlugin] Calculated fullPath:", fullPath)
            if (!fullPath) {
                console.log("[PropertyClickPlugin] Could not calculate path")
                return
            }

            console.log("[PropertyClickPlugin] Calling onPropertyClick with path:", fullPath)
            onPropertyClick(fullPath)
        }

        rootElement.addEventListener("click", handleClick)
        rootElement.addEventListener("mouseover", handleMouseEnter)
        rootElement.addEventListener("mouseout", handleMouseLeave)
        rootElement.addEventListener("longtext-drill-in", handleLongTextDrillIn)

        return () => {
            rootElement.removeEventListener("click", handleClick)
            rootElement.removeEventListener("mouseover", handleMouseEnter)
            rootElement.removeEventListener("mouseout", handleMouseLeave)
            rootElement.removeEventListener("longtext-drill-in", handleLongTextDrillIn)
        }
    }, [editor, onPropertyClick, language])

    return null
}
