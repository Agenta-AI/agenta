import {
    EditorConfig,
    ElementNode,
    LexicalNode,
    NodeKey,
    SerializedElementNode,
    Spread,
} from "lexical"
import {$createCodeHighlightNode} from "./CodeHighlightNode"

export type SerializedCodeLineNode = Spread<
    {
        indentLevel: number
        collapsed: boolean
        hidden: boolean
    },
    SerializedElementNode
>

export class CodeLineNode extends ElementNode {
    __indentLevel: number
    __collapsed: boolean
    __hidden: boolean

    static getType(): string {
        return "code-line"
    }

    static clone(node: CodeLineNode): CodeLineNode {
        return new CodeLineNode(node.__indentLevel, node.__collapsed, node.__hidden, node.__key)
    }

    constructor(
        indentLevel: number = 0,
        collapsed: boolean = false,
        hidden: boolean = false,
        key?: NodeKey,
    ) {
        super(key)
        this.__indentLevel = indentLevel
        this.__collapsed = collapsed
        this.__hidden = hidden
    }

    createDOM(_config: EditorConfig): HTMLElement {
        const element = document.createElement("div")
        element.className = "code-line"
        element.style.position = "relative"
        element.setAttribute("data-lexical-key", this.getKey())
        element.style.display = this.__hidden ? "none" : "block"

        const buttonContainer = document.createElement("div")
        buttonContainer.classList.add("button-container")
        buttonContainer.style.position = "absolute"
        buttonContainer.style.left = "-20px" // Adjust this value as needed
        buttonContainer.style.top = "0"

        const toggleButton = document.createElement("button")
        toggleButton.textContent = this.__collapsed ? "+" : "-"
        buttonContainer.appendChild(toggleButton)

        element.appendChild(buttonContainer)
        return element
    }

    // TODO: THIS IS WORKING BUT NOT A CORRECT IMPLEMENTATION. FIX NEEDED
    updateDOM(prevNode: CodeLineNode, dom: HTMLElement): boolean {
        const self = this.getLatest()
        dom.setAttribute("data-lexical-key", this.getKey())
        dom.style.display = self.__hidden ? "none" : "block"
        const buttonContainer = dom.querySelector(".button-container")
        if (buttonContainer) {
            const toggleButton = buttonContainer.querySelector("button")
            if (toggleButton) {
                buttonContainer.removeChild(toggleButton)
                const newToggleButton = document.createElement("button")
                const toggleButtonNewText = self.__collapsed ? "+" : "-"

                newToggleButton.textContent = toggleButtonNewText

                buttonContainer.appendChild(newToggleButton)
                dom.prepend(buttonContainer)
            }
        }

        return false
    }

    static importJSON(serializedNode: SerializedCodeLineNode): CodeLineNode {
        const node = $createCodeLineNode(
            serializedNode.indentLevel,
            serializedNode.collapsed,
            serializedNode.hidden,
        )
        return node
    }

    exportJSON(): SerializedCodeLineNode {
        return {
            ...super.exportJSON(),
            indentLevel: this.__indentLevel,
            collapsed: this.__collapsed,
            hidden: this.__hidden,
            type: "code-line",
            version: 1,
        }
    }

    getIndentLevel(): number {
        return this.getLatest().__indentLevel
    }

    setIndentLevel(level: number): void {
        const self = this.getWritable()
        self.__indentLevel = level
    }

    isCollapsed(): boolean {
        return this.getLatest().__collapsed
    }

    setCollapsed(collapsed: boolean): void {
        const self = this.getWritable()
        self.__collapsed = collapsed
    }

    isHidden(): boolean {
        return this.getLatest().__hidden
    }

    setHidden(hidden: boolean): void {
        const self = this.getWritable()
        self.__hidden = hidden
    }

    toggleCollapsed(): void {
        const self = this.getWritable()
        self.__collapsed = !self.__collapsed
    }

    appendCodeHighlight(text: string, highlightType?: string | null | undefined): void {
        const codeHighlightNode = $createCodeHighlightNode(text, highlightType)
        this.append(codeHighlightNode)
    }
}

export function $createCodeLineNode(
    indentLevel: number = 0,
    collapsed: boolean = false,
    hidden: boolean = false,
): CodeLineNode {
    return new CodeLineNode(indentLevel, collapsed, hidden)
}

export function $isCodeLineNode(node: LexicalNode | null | undefined): node is CodeLineNode {
    return node instanceof CodeLineNode
}
