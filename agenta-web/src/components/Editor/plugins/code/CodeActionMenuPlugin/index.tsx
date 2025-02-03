import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {$getRoot, $getNearestNodeFromDOMNode} from "lexical"
import {Copy, Trash2, ChevronDown} from "lucide-react"
import {useCallback, useEffect, useRef, useState} from "react"
import {createPortal} from "react-dom"
import {$isCodeNode, $createCodeNode} from "../CodeNode/CodeNode"
import {getLanguageFriendlyName, getCodeLanguages} from "../CodeNode/CodeHighlightNode"
import {PrettierButton} from "./PrettierButton"

const CODE_PADDING = 8

export function CodeActionMenuPlugin(): JSX.Element | null {
    const [editor] = useLexicalComposerContext()
    const [isVisible, setIsVisible] = useState(false)
    const [showLanguages, setShowLanguages] = useState(false)
    const [position, setPosition] = useState({top: 0, right: 0})
    const [lang, setLang] = useState("")
    const [codeNode, setCodeNode] = useState<any>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const codeDOMNodeRef = useRef<HTMLElement | null>(null)

    const getCodeDOMNode = useCallback(() => {
        return codeDOMNodeRef.current
    }, [])

    const updateMenu = useCallback(
        (codeDOMNode: HTMLElement | null) => {
            if (!codeDOMNode) return

            codeDOMNodeRef.current = codeDOMNode

            editor.update(() => {
                const maybeCodeNode = $getNearestNodeFromDOMNode(codeDOMNode)

                if ($isCodeNode(maybeCodeNode)) {
                    const language = maybeCodeNode.getLanguage() || ""
                    setLang(language)
                    setCodeNode(maybeCodeNode)

                    const editorContainer = editor.getRootElement()?.closest(".editor-container")
                    if (!editorContainer) return

                    const {top: containerTop, right: containerRight} =
                        editorContainer.getBoundingClientRect()
                    const {top: codeTop, right: codeRight} = codeDOMNode.getBoundingClientRect()

                    setPosition({
                        top: codeTop - containerTop,
                        right: containerRight - codeRight + CODE_PADDING,
                    })
                    setIsVisible(true)
                }
            })
        },
        [editor],
    )

    useEffect(() => {
        const editorContainer = editor.getRootElement()?.closest(".editor-container")
        if (!editorContainer) return

        const handleMouseEnter = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            const codeDOMNode = target.closest("code.editor-code") as HTMLElement | null
            if (codeDOMNode) {
                updateMenu(codeDOMNode)
            }
        }

        const handleMouseLeave = (e: MouseEvent) => {
            const target = e.relatedTarget as HTMLElement
            const isCodeOrMenu =
                target?.closest("code.editor-code") || target?.closest(".code-action-menu")
            if (!isCodeOrMenu) {
                setIsVisible(false)
                setShowLanguages(false)
            }
        }

        editorContainer.addEventListener("mouseenter", handleMouseEnter as EventListener, true)
        editorContainer.addEventListener("mouseleave", handleMouseLeave as EventListener, true)

        return () => {
            editorContainer.removeEventListener(
                "mouseenter",
                handleMouseEnter as EventListener,
                true,
            )
            editorContainer.removeEventListener(
                "mouseleave",
                handleMouseLeave as EventListener,
                true,
            )
        }
    }, [editor, updateMenu])

    const copyContent = useCallback(() => {
        if (codeNode) {
            editor.update(() => {
                const content = codeNode.getTextContent()
                navigator.clipboard.writeText(content)
            })
        }
    }, [codeNode, editor])

    const deleteContent = useCallback(() => {
        if (codeNode) {
            editor.update(() => {
                const language = codeNode.language
                codeNode.remove()
                const newNode = $createCodeNode(language)
                const root = $getRoot()

                if (!root.getChildren().length) {
                    root.append(newNode)
                }
            })
        }
    }, [codeNode, editor])

    const changeLanguage = useCallback(
        (newLang: string) => {
            if (codeNode) {
                editor.update(() => {
                    const newNode = $createCodeNode(newLang)
                    newNode.append(...codeNode.getChildren())
                    codeNode.replace(newNode)
                })
                setLang(newLang)
                setShowLanguages(false)
            }
        },
        [codeNode, editor],
    )

    const codeFriendlyName = getLanguageFriendlyName(lang)
    const languages = getCodeLanguages()

    const editorContainer = editor.getRootElement()?.closest(".editor-container")
    if (!editorContainer || !isVisible) return null

    return createPortal(
        <div
            ref={menuRef}
            className="code-action-menu absolute flex items-center gap-2 bg-white shadow-lg rounded-md py-1 px-2 border z-50"
            style={{
                top: position.top,
                right: position.right,
            }}
            onMouseEnter={() => setIsVisible(true)}
        >
            <div className="relative">
                <button
                    className="text-xs text-gray-500 border-r pr-2 flex items-center gap-1"
                    onClick={() => setShowLanguages(!showLanguages)}
                >
                    {codeFriendlyName}
                    <ChevronDown size={12} />
                </button>
                {showLanguages && (
                    <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-md py-1 min-w-[120px] max-h-[200px] overflow-y-auto">
                        {languages.map((language) => (
                            <button
                                key={language}
                                className="w-full text-left px-3 py-1 text-xs hover:bg-gray-100"
                                onClick={() => changeLanguage(language)}
                            >
                                {getLanguageFriendlyName(language)}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <button className="p-1 hover:bg-gray-100 rounded" onClick={copyContent} title="Copy">
                <Copy size={16} />
            </button>
            <PrettierButton getCodeDOMNode={getCodeDOMNode} />
            <button
                className="p-1 hover:bg-gray-100 rounded text-red-600"
                onClick={deleteContent}
                title="Delete"
            >
                <Trash2 size={16} />
            </button>
        </div>,
        editorContainer,
    )
}
