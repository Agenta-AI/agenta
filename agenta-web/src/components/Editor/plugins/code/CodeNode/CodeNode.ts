import {
    EditorConfig,
    ElementNode,
    LexicalNode,
    NodeKey,
    SerializedElementNode,
    Spread,
} from "lexical"
import {$createCodeLineNode, CodeLineNode} from "./CodeLineNode"

export type SerializedCodeNode = Spread<
    {
        language: string | null | undefined
    },
    SerializedElementNode
>

export class CodeNode extends ElementNode {
    __language: string

    static getType(): string {
        return "code"
    }

    static clone(node: CodeNode): CodeNode {
        return new CodeNode(node.__language, node.__key)
    }

    constructor(language?: string, key?: NodeKey) {
        super(key)
        this.__language = language || "javascript"
    }

    createDOM(config: EditorConfig): HTMLElement {
        const element = document.createElement("code")
        element.className = config.theme.code || ""
        return element
    }

    updateDOM(): boolean {
        return false
    }

    static importJSON(serializedNode: SerializedCodeNode): CodeNode {
        const node = $createCodeNode(serializedNode.language ?? undefined)
        return node
    }

    exportJSON(): SerializedCodeNode {
        return {
            ...super.exportJSON(),
            language: this.getLanguage(),
            type: "code",
            version: 1,
        }
    }

    getLanguage(): string {
        return this.__language
    }

    setLanguage(language: string): void {
        this.__language = language
    }

    appendCodeLine(indentLevel: number = 0): CodeLineNode {
        const codeLineNode = $createCodeLineNode(indentLevel)
        this.append(codeLineNode)
        return codeLineNode
    }

    insertNewLineAfter(node: LexicalNode): CodeLineNode {
        const newLineNode = $createCodeLineNode()
        node.insertAfter(newLineNode)
        return newLineNode
    }

    initializeWithLine(): void {
        if (this.getChildren().length === 0) {
            this.appendCodeLine()
        }
    }
}

export function $createCodeNode(language?: string): CodeNode {
    const node = new CodeNode(language)
    node.initializeWithLine()
    return node
}

export function $isCodeNode(node: LexicalNode | null | undefined): node is CodeNode {
    return node instanceof CodeNode
}
