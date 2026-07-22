import {
    $createParagraphNode,
    $createTextNode,
    $getNodeByKey,
    $getRoot,
    $isParagraphNode,
    TextNode,
    type LexicalEditor,
} from "lexical"

/**
 * Speech dictated into the editor, as two live text nodes rather than a document rewrite.
 *
 * Rewriting the whole document on every interim result (the obvious approach) discards the undo
 * history, re-parses markdown several times a second, and overwrites anything typed alongside it.
 * Instead a session owns two nodes appended once — one for committed words, one for the provisional
 * tail — and only their text is set as speech arrives. Everything else in the document is untouched.
 */

/** Provisional speech. Opacity + italic reads as "not settled yet" in either theme without a colour
 * token, and leaves nothing behind once the words are committed. */
export const INTERIM_STYLE = "opacity: 0.55; font-style: italic;"

export interface DictationSession {
    /** Push the recogniser's committed text and its provisional tail. */
    update: (finalText: string, interimText: string) => void
    /** Settle the session: provisional words are kept but lose their styling. */
    end: () => void
}

/** Open a dictation session at the end of the document. */
export function beginDictation(editor: LexicalEditor): DictationSession {
    let finalKey: string | null = null
    let interimKey: string | null = null
    // Separator from whatever was already typed, so dictation doesn't run into it.
    let prefix = ""

    /** Resolve the session's nodes, recreating any the editor has since collected.
     * `$` prefix per Lexical convention: only valid inside a read/update context. */
    const $nodes = (): {finalNode: TextNode; interimNode: TextNode} => {
        const root = $getRoot()
        const last = root.getLastChild()
        const paragraph = $isParagraphNode(last) ? last : $createParagraphNode()
        if (paragraph !== last) root.append(paragraph)

        const existingFinal = finalKey ? $getNodeByKey(finalKey) : null
        let finalNode: TextNode
        if (existingFinal instanceof TextNode) {
            finalNode = existingFinal
        } else {
            finalNode = $createTextNode("")
            paragraph.append(finalNode)
            finalKey = finalNode.getKey()
        }

        const existingInterim = interimKey ? $getNodeByKey(interimKey) : null
        let interimNode: TextNode
        if (existingInterim instanceof TextNode) {
            interimNode = existingInterim
        } else {
            interimNode = $createTextNode("")
            interimNode.setStyle(INTERIM_STYLE)
            paragraph.append(interimNode)
            interimKey = interimNode.getKey()
        }

        return {finalNode, interimNode}
    }

    editor.update(() => {
        const existing = $getRoot().getTextContent()
        prefix = existing && !/\s$/.test(existing) ? " " : ""
        $nodes()
    })

    return {
        update(finalText, interimText) {
            editor.update(
                () => {
                    const {finalNode, interimNode} = $nodes()
                    finalNode.setTextContent(prefix + finalText)
                    interimNode.setTextContent(
                        interimText && finalText ? ` ${interimText}` : interimText,
                    )
                    if (interimNode.getStyle() !== INTERIM_STYLE) {
                        interimNode.setStyle(INTERIM_STYLE)
                    }
                },
                // One undo entry for the dictation, not one per interim tick.
                {tag: "history-merge"},
            )
        },
        end() {
            editor.update(() => {
                const interimNode = interimKey ? $getNodeByKey(interimKey) : null
                if (interimNode instanceof TextNode) {
                    // Keep any tail the recogniser never settled — just make it read as final.
                    if (interimNode.getTextContent()) interimNode.setStyle("")
                    else interimNode.remove()
                }
                const finalNode = finalKey ? $getNodeByKey(finalKey) : null
                if (finalNode instanceof TextNode && !finalNode.getTextContent().trim()) {
                    finalNode.remove()
                }
                $getRoot().selectEnd()
            })
            finalKey = null
            interimKey = null
        },
    }
}
