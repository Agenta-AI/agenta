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

/** Provisional speech: a gentle dim, nothing more. The words are visibly rewriting themselves as
 * the recogniser settles, which is most of the signal — italics or a heavier fade on a run this
 * long reads as emphasis and costs legibility. Opacity alone also needs no colour token, so it
 * holds in either theme, and leaves nothing behind once the words are committed. */
export const INTERIM_STYLE = "opacity: 0.65;"

/**
 * Visually inert, and load-bearing: Lexical merges adjacent text nodes that share a format and
 * style, so an unstyled committed node is swallowed by whatever was already typed before it. The
 * session then can no longer find its own node, re-creates it past the interim tail, and re-appends
 * the whole transcript on the next result — "Draft" + "hello world" dictated becomes
 * "Draft  hello hello hello world". A style of its own keeps the node addressable; `end()` drops it
 * so the words settle into ordinary text and merge like anything else.
 */
const COMMITTED_STYLE = "opacity: 1;"

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

        // Resolved first, because a replacement committed node has to be placed relative to it.
        const existingInterim = interimKey ? $getNodeByKey(interimKey) : null
        const survivingInterim = existingInterim instanceof TextNode ? existingInterim : null

        const existingFinal = finalKey ? $getNodeByKey(finalKey) : null
        let finalNode: TextNode
        if (existingFinal instanceof TextNode) {
            finalNode = existingFinal
        } else {
            finalNode = $createTextNode("")
            finalNode.setStyle(COMMITTED_STYLE)
            // Lexical collects the node while it holds no text, which is the norm until the first
            // word settles. A replacement must go back BEFORE the tail — appending it renders the
            // transcript in reverse ("hello world and" as " andhello world") until the tail empties.
            if (survivingInterim) survivingInterim.insertBefore(finalNode)
            else paragraph.append(finalNode)
            finalKey = finalNode.getKey()
        }

        let interimNode: TextNode
        if (survivingInterim) {
            interimNode = survivingInterim
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
                    if (finalNode.getStyle() !== COMMITTED_STYLE) {
                        finalNode.setStyle(COMMITTED_STYLE)
                    }
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
                if (finalNode instanceof TextNode) {
                    // Empty means the session caught no words — drop it, separator space and all.
                    if (finalNode.getTextContent().trim()) finalNode.setStyle("")
                    else finalNode.remove()
                }
                $getRoot().selectEnd()
            })
            finalKey = null
            interimKey = null
        },
    }
}
