import {useEffect} from "react"

import {TOGGLE_LINK_COMMAND} from "@lexical/link"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getSelection, $isRangeSelection, COMMAND_PRIORITY_CRITICAL, PASTE_COMMAND} from "lexical"

const URL_WITH_SCHEME = /^(?:https?:\/\/|mailto:)[^\s]+$/i
const BARE_WWW = /^www\.[^\s]+$/i

/** Normalize pasted text to a link href, or null when it isn't a single bare URL. */
function toLinkHref(text: string): string | null {
    if (URL_WITH_SCHEME.test(text)) return text
    if (BARE_WWW.test(text)) return `https://${text}`
    return null
}

/**
 * Paste a URL over a non-empty text selection → wrap the selection in a link (the expected rich-editor
 * behaviour). Registered at CRITICAL priority so it runs before Lexical's default paste, which would
 * otherwise just drop the URL in as text. It only acts on "a lone URL over a range selection" and
 * returns false otherwise, so ordinary paste and the file-paste handler are left untouched.
 */
export function LinkPastePlugin() {
    const [editor] = useLexicalComposerContext()

    useEffect(() => {
        return editor.registerCommand(
            PASTE_COMMAND,
            (event) => {
                const clipboard = (event as ClipboardEvent).clipboardData
                if (!clipboard) return false
                // A URL paste never carries files; bail so the file-paste path stays in charge.
                if (clipboard.files && clipboard.files.length > 0) return false
                const href = toLinkHref(clipboard.getData("text/plain").trim())
                if (!href) return false
                const selection = $getSelection()
                if (!$isRangeSelection(selection) || selection.isCollapsed()) return false
                event.preventDefault()
                editor.dispatchCommand(TOGGLE_LINK_COMMAND, href)
                return true
            },
            COMMAND_PRIORITY_CRITICAL,
        )
    }, [editor])

    return null
}
