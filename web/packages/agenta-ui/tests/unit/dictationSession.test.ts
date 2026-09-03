// @vitest-environment jsdom
import {createEditor, $getRoot, $createParagraphNode, $createTextNode} from "lexical"
import {describe, expect, it} from "vitest"

import {INTERIM_STYLE, beginDictation} from "../../src/RichChatInput/plugins/dictation"

/**
 * Dictation writes through two live text nodes rather than rewriting the document, so the cases
 * that matter are the ones where those nodes must survive — or be handed over — without taking
 * anything already in the composer with them.
 */

const editorWith = (text = "") => {
    // Surface a Lexical error as a test failure rather than letting it pass silently.
    const editor = createEditor({
        onError: (e) => {
            throw e
        },
    })
    editor.update(
        () => {
            const paragraph = $createParagraphNode()
            if (text) paragraph.append($createTextNode(text))
            $getRoot().append(paragraph)
        },
        {discrete: true},
    )
    return editor
}

/** No root element is attached here, so queued updates commit on a microtask — force them out. */
const flush = (editor: ReturnType<typeof createEditor>) => editor.update(() => {}, {discrete: true})

const textOf = (editor: ReturnType<typeof createEditor>) => {
    flush(editor)
    return editor.getEditorState().read(() => $getRoot().getTextContent())
}

const interimStyled = (editor: ReturnType<typeof createEditor>) => {
    flush(editor)
    return editor.getEditorState().read(() =>
        $getRoot()
            .getAllTextNodes()
            .filter((n) => n.getStyle() === INTERIM_STYLE && n.getTextContent())
            .map((n) => n.getTextContent()),
    )
}

describe("dictation session", () => {
    it("streams committed words and marks the provisional tail", () => {
        const editor = editorWith()
        const session = beginDictation(editor)
        session.update("hello", "wor")
        expect(textOf(editor)).toBe("hello wor")
        expect(interimStyled(editor)).toEqual([" wor"])
    })

    it("keeps the tail behind the committed words when speech starts as interim", () => {
        const editor = editorWith()
        const session = beginDictation(editor)
        // Nothing has settled yet, so the committed node holds no text and Lexical collects it.
        session.update("", "hel")
        session.update("", "hello wor")
        // Its replacement has to go back in front of the tail, or the transcript reads backwards.
        session.update("hello world", "and")
        expect(textOf(editor)).toBe("hello world and")
        session.update("hello world and then", "")
        session.end()
        expect(textOf(editor)).toBe("hello world and then")
    })

    it("streams cleanly into a composer that already has text", () => {
        const editor = editorWith("Draft")
        const session = beginDictation(editor)
        // One result at a time, the way the recogniser delivers them. Every commit used to
        // re-append the whole transcript here, because Lexical had merged the session's own node
        // into "Draft" and it could no longer find it.
        session.update("", "hel")
        session.update("hello", "")
        session.update("hello", "wor")
        session.update("hello world", "")
        expect(textOf(editor)).toBe("Draft hello world")
        session.end()
        expect(textOf(editor)).toBe("Draft hello world")
    })

    it("leaves what was already typed alone and separates itself from it", () => {
        const editor = editorWith("Draft so far")
        beginDictation(editor).update("dictated", "")
        expect(textOf(editor)).toBe("Draft so far dictated")
    })

    it("keeps an unsettled tail on end, as plain text", () => {
        const editor = editorWith()
        const session = beginDictation(editor)
        session.update("hello", "world")
        session.end()
        expect(textOf(editor)).toBe("hello world")
        expect(interimStyled(editor)).toEqual([])
    })

    it("hands over to a session opened on top of it without stranding its words", () => {
        const editor = editorWith()
        const first = beginDictation(editor)
        first.update("first take", "tail")

        // What the editor handle does when the mic is re-pressed while the recogniser is still
        // closing: settle the outgoing session, then open a new one. Its words must stay put as
        // ordinary text rather than being orphaned at interim opacity.
        first.end()
        const second = beginDictation(editor)
        second.update("second take", "")

        expect(textOf(editor)).toBe("first take tail second take")
        expect(interimStyled(editor)).toEqual([])
    })

    it("leaves nothing behind when a session ends with no speech at all", () => {
        const editor = editorWith("Draft so far")
        const session = beginDictation(editor)
        session.update("", "")
        session.end()
        expect(textOf(editor)).toBe("Draft so far")
    })
})
