/**
 * CodeSegmentNode.ts
 *
 * An intermediate container node that groups ~200 CodeLineNodes within a CodeBlockNode.
 * Segments reduce Lexical reconciliation from O(total_lines) to O(segment_size) because
 * only the dirty segment's children are reconciled — clean segments are skipped entirely.
 *
 * The DOM element uses `display: contents` so it is invisible to CSS layout —
 * child line divs behave as if they are direct children of the <code> element
 * for layout, counters, flex, etc.
 *
 * @module CodeSegmentNode
 */
import {ElementNode, LexicalNode, SerializedElementNode, EditorConfig} from "lexical"

export type SerializedCodeSegmentNode = SerializedElementNode

export class CodeSegmentNode extends ElementNode {
    static getType(): string {
        return "code-segment"
    }

    static clone(node: CodeSegmentNode): CodeSegmentNode {
        return new CodeSegmentNode(node.__key)
    }

    constructor(key?: string) {
        super(key)
    }

    createDOM(_config: EditorConfig): HTMLElement {
        const div = document.createElement("div")
        div.classList.add("code-segment")
        // display:contents makes this wrapper invisible to CSS layout.
        // Child line divs behave as direct children of <code> for
        // layout, CSS counters, flex, etc.
        div.style.display = "contents"
        return div
    }

    updateDOM(): boolean {
        // Never needs DOM update — the segment is purely structural.
        return false
    }

    exportJSON(): SerializedCodeSegmentNode {
        return {
            ...super.exportJSON(),
            type: "code-segment",
            version: 1,
        }
    }

    static importJSON(_json: SerializedCodeSegmentNode): CodeSegmentNode {
        return new CodeSegmentNode()
    }

    isInline(): false {
        return false
    }
}

export function $createCodeSegmentNode(): CodeSegmentNode {
    return new CodeSegmentNode()
}

export function $isCodeSegmentNode(node: LexicalNode | null | undefined): node is CodeSegmentNode {
    return node instanceof CodeSegmentNode
}
