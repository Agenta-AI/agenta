import {useEffect} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {defineExtension, type LexicalEditor} from "lexical"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PropertyClickConfig {
    onPropertyClick: ((path: string) => void) | null
    language: string
}

interface PropertyClickPluginProps {
    onPropertyClick?: (path: string) => void
    language?: string
}

// ---------------------------------------------------------------------------
// JSON path calculation
// ---------------------------------------------------------------------------

function calculateJsonPath(rootElement: HTMLElement, targetElement: HTMLElement): string | null {
    const range = document.createRange()
    range.setStartBefore(rootElement.firstChild || rootElement)
    range.setEndBefore(targetElement)
    const textBefore = range.toString()

    const stack: {type: "object" | "array"; key?: string; index: number}[] = []
    let inString = false
    let currentKey = ""
    let collectingKey = false
    let i = 0

    while (i < textBefore.length) {
        const char = textBefore[i]

        if (char === '"' && (i === 0 || textBefore[i - 1] !== "\\")) {
            if (!inString) {
                inString = true
                collectingKey = true
                currentKey = ""
            } else {
                inString = false
                if (collectingKey && currentKey) {
                    const afterQuote = textBefore.slice(i + 1).trimStart()
                    if (afterQuote.startsWith(":") && stack.length > 0) {
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

        if (char === "{") {
            stack.push({type: "object", index: 0})
        } else if (char === "[") {
            stack.push({type: "array", index: 0})
        } else if (char === "}" || char === "]") {
            stack.pop()
        } else if (char === ",") {
            if (stack.length > 0 && stack[stack.length - 1].type === "array") {
                stack[stack.length - 1].index++
            }
        }

        i++
    }

    const path: string[] = []
    for (let j = 0; j < stack.length; j++) {
        const frame = stack[j]
        const isLast = j === stack.length - 1

        if (frame.type === "array") {
            path.push(String(frame.index))
        } else if (frame.type === "object" && frame.key && !isLast) {
            path.push(frame.key)
        }
    }

    const propertyText = targetElement.textContent || ""
    const clickedKey = propertyText.replace(/^"|"$/g, "")

    if (!clickedKey) return null

    path.push(clickedKey)

    return path.join(".")
}

// ---------------------------------------------------------------------------
// Behavior registration (used by the extension and the legacy React wrapper)
// ---------------------------------------------------------------------------

export function registerPropertyClickBehavior(
    editor: LexicalEditor,
    {onPropertyClick, language = "json"}: PropertyClickPluginProps,
): () => void {
    if (!onPropertyClick || language !== "json") {
        return () => {}
    }

    let rootElement: HTMLElement | null = null

    const handleMouseEnter = (event: MouseEvent) => {
        if (!rootElement) return
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
        if (!rootElement) return
        const target = event.target as HTMLElement

        if (!target.classList.contains("token-property")) return

        const fullPath = calculateJsonPath(rootElement, target)
        if (!fullPath) return

        event.preventDefault()
        event.stopPropagation()

        onPropertyClick(fullPath)
    }

    const handleLongTextDrillIn = (event: Event) => {
        if (!rootElement) return
        const customEvent = event as CustomEvent<{propertyElement: HTMLElement}>
        const propertyElement = customEvent.detail?.propertyElement
        if (!propertyElement) {
            return
        }

        const fullPath = calculateJsonPath(rootElement, propertyElement)
        if (!fullPath) {
            return
        }

        onPropertyClick(fullPath)
    }

    const attach = (nextRoot: HTMLElement | null) => {
        if (!nextRoot) return
        rootElement = nextRoot
        rootElement.addEventListener("click", handleClick)
        rootElement.addEventListener("mouseover", handleMouseEnter)
        rootElement.addEventListener("mouseout", handleMouseLeave)
        rootElement.addEventListener("longtext-drill-in", handleLongTextDrillIn)
    }

    const detach = (prevRoot: HTMLElement | null) => {
        if (!prevRoot) return
        prevRoot.removeEventListener("click", handleClick)
        prevRoot.removeEventListener("mouseover", handleMouseEnter)
        prevRoot.removeEventListener("mouseout", handleMouseLeave)
        prevRoot.removeEventListener("longtext-drill-in", handleLongTextDrillIn)
        if (rootElement === prevRoot) {
            rootElement = null
        }
    }

    const unregisterRootListener = editor.registerRootListener((nextRoot, prevRoot) => {
        detach(prevRoot)
        attach(nextRoot)
    })

    return () => {
        detach(rootElement)
        unregisterRootListener()
    }
}

// ---------------------------------------------------------------------------
// Lexical Extension
// ---------------------------------------------------------------------------

export const PropertyClickExtension = defineExtension({
    name: "@agenta/editor/code/PropertyClick",
    config: {
        onPropertyClick: null,
        language: "json",
    } as PropertyClickConfig,
    register: (editor, config) => {
        return registerPropertyClickBehavior(editor, {
            onPropertyClick: config.onPropertyClick ?? undefined,
            language: config.language,
        })
    },
})

// ---------------------------------------------------------------------------
// Legacy React plugin wrapper (backward-compatible export)
// ---------------------------------------------------------------------------

export default function PropertyClickPlugin({
    onPropertyClick,
    language = "json",
}: PropertyClickPluginProps) {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return registerPropertyClickBehavior(editor, {onPropertyClick, language})
    }, [editor, onPropertyClick, language])

    return null
}
