import {getDisplayContent} from "@agenta/chat/assets"
import type {UIMessage} from "ai"

import {parseSentContextLine, type PageContext} from "../builder/pageContext"

/** The page context line of a stored or live user message, rebuilt from its text. */
export const sentContextOf = (message: UIMessage): PageContext | null => {
    const words = getDisplayContent(message)
    if (typeof words !== "string") return null
    const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
    return parseSentContextLine(text, words)
}
