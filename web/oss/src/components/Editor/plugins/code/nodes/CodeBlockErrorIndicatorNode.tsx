// nodes/CodeBlockErrorIndicatorNode.ts
import {type JSX} from "react"

import {DecoratorNode, EditorConfig} from "lexical"

import {CodeBlockErrorIndicator} from "../components/CodeBlockErrorIndicator"

export class CodeBlockErrorIndicatorNode extends DecoratorNode<JSX.Element> {
    __errors: string[]

    static getType(): string {
        return "code-block-error-indicator"
    }

    static clone(node: CodeBlockErrorIndicatorNode) {
        return new CodeBlockErrorIndicatorNode(node.__errors, node.__key)
    }

    constructor(errors: string[] = [], key?: string) {
        super(key)
        this.__errors = errors
    }

    createDOM(config: EditorConfig): HTMLElement {
        const container = document.createElement("span")
        container.classList.add("code-block-error-anchor")
        return container
    }

    exportJSON() {
        return {
            type: "code-block-error-indicator",
            version: 1,
        }
    }

    decorate(): JSX.Element {
        return <CodeBlockErrorIndicator errors={this.__errors} />
    }

    isInline(): boolean {
        return false
    }

    updateDOM(): false {
        return false
    }

    clone(): CodeBlockErrorIndicatorNode {
        return new CodeBlockErrorIndicatorNode(this.__errors, this.__key)
    }
}

export function $createCodeBlockErrorIndicatorNode(errors: string[] = []) {
    return new CodeBlockErrorIndicatorNode(errors)
}

export function $isCodeBlockErrorIndicatorNode(node: unknown): node is CodeBlockErrorIndicatorNode {
    return node instanceof CodeBlockErrorIndicatorNode
}
