import {useEffect, useLayoutEffect, useCallback, useRef} from "react"
import * as React from "react"
import type {JSX} from "react"

import {$createCodeNode, $isCodeNode} from "@lexical/code"
import {$convertFromMarkdownString} from "@lexical/markdown"
import {AutoLinkPlugin, createLinkMatcherWithRegExp} from "@lexical/react/LexicalAutoLinkPlugin"
import {CheckListPlugin} from "@lexical/react/LexicalCheckListPlugin"
import {ClickableLinkPlugin} from "@lexical/react/LexicalClickableLinkPlugin"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {HorizontalRulePlugin} from "@lexical/react/LexicalHorizontalRulePlugin"
import {LinkPlugin} from "@lexical/react/LexicalLinkPlugin"
import {ListPlugin} from "@lexical/react/LexicalListPlugin"
import {MarkdownShortcutPlugin} from "@lexical/react/LexicalMarkdownShortcutPlugin"
import {TabIndentationPlugin} from "@lexical/react/LexicalTabIndentationPlugin"
import {TablePlugin} from "@lexical/react/LexicalTablePlugin"
import {useAtom} from "jotai"
import {
    $getRoot,
    $createTextNode,
    KEY_ENTER_COMMAND,
    PASTE_COMMAND,
    $getSelection,
    $isRangeSelection,
    COMMAND_PRIORITY_HIGH,
    type ElementNode,
} from "lexical"

import {markdownViewAtom} from "../../state/assets/atoms"
import {
    isEditorLargeDocument,
    isLargeRichTextDocument,
    setEditorLargeDocumentFlag,
} from "../../utils/largeDocument"
import {showEditorLoadingOverlay} from "../code/utils/loadingOverlay"

import {$convertToMarkdownStringCustom, PLAYGROUND_TRANSFORMERS} from "./assets/transformers"
import {SET_MARKDOWN_VIEW, TOGGLE_MARKDOWN_VIEW} from "./commands"
import {importMarkdownWithHtmlBatches} from "./utils/htmlImport"

const URL_REGEX =
    /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)(?<![-.+():%])/

const EMAIL_REGEX =
    /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/

const MATCHERS = [
    createLinkMatcherWithRegExp(URL_REGEX, (text) => {
        return text.startsWith("http") ? text : `https://${text}`
    }),
    createLinkMatcherWithRegExp(EMAIL_REGEX, (text) => {
        return `mailto:${text}`
    }),
]

const MARKDOWN_VIEW_TOGGLE_UPDATE_TAG = "agenta:markdown-view-toggle"

function LexicalAutoLinkPlugin(): JSX.Element {
    return <AutoLinkPlugin matchers={MATCHERS} />
}

interface Props {
    hasLinkAttributes?: boolean
}

const urlRegExp = new RegExp(
    /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[\w]*))?)/,
)
export function validateUrl(url: string): boolean {
    // TODO Fix UI for link insertion; it should never default to an invalid URL such as https://.
    // Maybe show a dialog where they user can type the URL before inserting it.
    return url === "https://" || urlRegExp.test(url)
}

function LexicalLinkPlugin({hasLinkAttributes = false}: Props): JSX.Element {
    return (
        <LinkPlugin
            validateUrl={validateUrl}
            attributes={
                hasLinkAttributes
                    ? {
                          rel: "noopener noreferrer",
                          target: "_blank",
                      }
                    : undefined
            }
        />
    )
}

const MarkdownPlugin = ({
    id,
    largeDocumentMode = false,
}: {
    id: string
    largeDocumentMode?: boolean
}) => {
    const [, setMarkdownView] = useAtom(markdownViewAtom(id))
    const [editor] = useLexicalComposerContext()
    const markdownSourceCacheRef = useRef<{value: string; reusable: boolean}>({
        value: "",
        reusable: false,
    })
    const isMarkdownTogglePendingRef = useRef(false)

    const deferLargePasteUpdate = useCallback((callback: () => void) => {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(callback)
            })
            return
        }

        setTimeout(callback, 0)
    }, [])

    const $applyMarkdownViewUpdate = useCallback(
        (nextMarkdownView?: boolean) => {
            const root = $getRoot()
            const firstChild = root.getFirstChild()
            const isCurrentlyMarkdown =
                $isCodeNode(firstChild) && firstChild.getLanguage() === "markdown"
            const targetMarkdownView = nextMarkdownView ?? !isCurrentlyMarkdown

            if (targetMarkdownView === isCurrentlyMarkdown) {
                return
            }

            if (isCurrentlyMarkdown) {
                const markdownSource = firstChild.getTextContent()
                markdownSourceCacheRef.current = {
                    value: markdownSource,
                    reusable: true,
                }
                setEditorLargeDocumentFlag(editor, isLargeRichTextDocument(markdownSource))
                if (isLargeRichTextDocument(markdownSource)) {
                    importMarkdownWithHtmlBatches(editor, markdownSource)
                } else {
                    $convertFromMarkdownString(
                        markdownSource,
                        PLAYGROUND_TRANSFORMERS,
                        undefined,
                        true,
                    )
                }
                setMarkdownView(false)
                return
            }

            const cachedMarkdownSource = markdownSourceCacheRef.current
            const markdownSource =
                cachedMarkdownSource.reusable && cachedMarkdownSource.value
                    ? cachedMarkdownSource.value
                    : $convertToMarkdownStringCustom(PLAYGROUND_TRANSFORMERS, undefined, true)

            const codeNode = $createCodeNode("markdown")
            codeNode.append($createTextNode(markdownSource))
            root.clear().append(codeNode)
            codeNode.selectStart()

            markdownSourceCacheRef.current = {
                value: markdownSource,
                reusable: true,
            }
            setEditorLargeDocumentFlag(editor, isLargeRichTextDocument(markdownSource))
            setMarkdownView(true)
        },
        [editor, setMarkdownView],
    )

    const runMarkdownViewUpdate = useCallback(
        ({
            nextMarkdownView,
            defer,
            overlayMessage,
        }: {
            nextMarkdownView?: boolean
            defer: boolean
            overlayMessage?: string
        }) => {
            if (isMarkdownTogglePendingRef.current) {
                return
            }

            isMarkdownTogglePendingRef.current = true

            const executeUpdate = (removeOverlay?: (() => void) | null) => {
                editor.update(
                    () => {
                        $applyMarkdownViewUpdate(nextMarkdownView)
                    },
                    {
                        tag: MARKDOWN_VIEW_TOGGLE_UPDATE_TAG,
                        onUpdate: () => {
                            isMarkdownTogglePendingRef.current = false
                            removeOverlay?.()
                        },
                    },
                )
            }

            if (!defer) {
                executeUpdate()
                return
            }

            const removeOverlay = showEditorLoadingOverlay(
                editor,
                overlayMessage ?? "Switching markdown view…",
            )

            deferLargePasteUpdate(() => {
                executeUpdate(removeOverlay)
            })
        },
        [$applyMarkdownViewUpdate, deferLargePasteUpdate, editor],
    )

    // Core handler: when nextMarkdownView is provided, explicitly set to that state;
    // when omitted, toggle the current state.
    const handleSetMarkdownView = useCallback(
        (nextMarkdownView?: boolean) => {
            let shouldRunToggle = false
            let shouldDeferToggle = false
            let overlayMessage = "Switching markdown view…"

            editor.getEditorState().read(() => {
                const root = $getRoot()
                const firstChild = root.getFirstChild()
                const isCurrentlyMarkdown =
                    $isCodeNode(firstChild) && firstChild.getLanguage() === "markdown"
                const targetMarkdownView = nextMarkdownView ?? !isCurrentlyMarkdown

                if (targetMarkdownView === isCurrentlyMarkdown) {
                    return
                }

                shouldRunToggle = true

                if (isCurrentlyMarkdown) {
                    shouldDeferToggle = isLargeRichTextDocument(firstChild.getTextContent())
                    overlayMessage = "Rendering markdown preview…"
                    return
                }

                shouldDeferToggle = largeDocumentMode || isEditorLargeDocument(editor)
                overlayMessage = "Switching to markdown source…"
            })

            if (!shouldRunToggle) {
                return
            }

            runMarkdownViewUpdate({
                nextMarkdownView,
                defer: shouldDeferToggle,
                overlayMessage,
            })
        },
        [editor, largeDocumentMode, runMarkdownViewUpdate],
    )

    const handleMarkdownToggle = useCallback(() => {
        handleSetMarkdownView()
    }, [handleSetMarkdownView])

    useEffect(() => {
        return editor.registerCommand(
            TOGGLE_MARKDOWN_VIEW,
            () => {
                handleMarkdownToggle()
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor, handleMarkdownToggle])

    // SET_MARKDOWN_VIEW: explicit state (true = markdown source, false = rich text)
    useLayoutEffect(() => {
        return editor.registerCommand(
            SET_MARKDOWN_VIEW,
            (nextMarkdownView) => {
                handleSetMarkdownView(nextMarkdownView)
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor, handleSetMarkdownView])

    useEffect(() => {
        return editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                editor.update(() => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return false

                    const anchorNode = selection.anchor.getNode()
                    const topNode = anchorNode.getTopLevelElementOrThrow()

                    if ($isCodeNode(topNode) && topNode.getLanguage() === "markdown") {
                        event?.preventDefault()
                        selection.insertRawText("\n")
                        return true
                    }
                })
                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [editor])

    // Prevent monospace-styled HTML from being converted into code blocks.
    //
    // Lexical's CodeNode.importDOM() registers a `div` handler that converts
    // any <div> whose font-family contains "monospace" into a CodeNode.
    // Source-code editors (VS Code, JetBrains, terminals) put monospace-styled
    // HTML in the clipboard, so pasting from them creates unwanted code blocks.
    //
    // For markdown/plaintext sources, we parse the plain text as markdown
    // using $convertFromMarkdownString so all constructs (headings, code
    // fences, lists, etc.) are converted to proper Lexical nodes.
    useEffect(() => {
        return editor.registerCommand(
            PASTE_COMMAND,
            (event: ClipboardEvent) => {
                const clipboardPlainText = event.clipboardData?.getData("text/plain")
                if (clipboardPlainText && isLargeRichTextDocument(clipboardPlainText)) {
                    event.preventDefault()
                    event.stopPropagation()

                    setEditorLargeDocumentFlag(editor, true)

                    const removeOverlay = showEditorLoadingOverlay(editor, "Pasting large content…")

                    deferLargePasteUpdate(() => {
                        editor.update(
                            () => {
                                const selection = $getSelection()
                                if (!$isRangeSelection(selection)) return

                                const root = $getRoot()
                                const firstChild = root.getFirstChild()
                                const isCurrentlyMarkdown =
                                    $isCodeNode(firstChild) &&
                                    firstChild.getLanguage() === "markdown"
                                const isEmptyEditor =
                                    root.getChildrenSize() === 0 ||
                                    (root.getChildrenSize() === 1 &&
                                        root.getFirstChild()?.getTextContent() === "")

                                if (isEmptyEditor) {
                                    const markdownNode = $createCodeNode("markdown")
                                    markdownNode.append($createTextNode(clipboardPlainText))
                                    root.clear().append(markdownNode)
                                    markdownNode.selectEnd()
                                    setMarkdownView(true)
                                    return
                                }

                                if (isCurrentlyMarkdown) {
                                    let markdownNode = firstChild

                                    if (!$isCodeNode(markdownNode)) {
                                        markdownNode = $createCodeNode("markdown")
                                        root.clear().append(markdownNode)
                                    }

                                    if (markdownNode.getChildrenSize() === 0) {
                                        markdownNode.append($createTextNode(""))
                                    }

                                    markdownNode.selectEnd()

                                    const nextSelection = $getSelection()
                                    if ($isRangeSelection(nextSelection)) {
                                        nextSelection.insertRawText(clipboardPlainText)
                                    }

                                    setMarkdownView(true)
                                    return
                                }

                                selection.insertRawText(clipboardPlainText)
                            },
                            {
                                onUpdate: () => {
                                    removeOverlay?.()
                                },
                            },
                        )
                    })

                    return true
                }

                const htmlData = event.clipboardData?.getData("text/html")
                if (!htmlData) return false

                // Only intercept when HTML contains monospace font styling
                if (!/font-family[^;]*monospace/i.test(htmlData)) return false

                if (!clipboardPlainText) return false

                // Check VS Code metadata to determine the source language.
                const vscodeData = event.clipboardData?.getData("vscode-editor-data")
                let sourceMode: string | undefined
                if (vscodeData) {
                    try {
                        sourceMode = JSON.parse(vscodeData)?.mode
                    } catch {
                        // ignore parse errors
                    }
                }

                // For actual code files (python, javascript, etc.), let Lexical
                // handle the paste normally — code should render as a code block.
                if (sourceMode && sourceMode !== "markdown" && sourceMode !== "plaintext") {
                    return false
                }

                event.preventDefault()

                // Parse the plain text as markdown so all constructs (headings,
                // code fences, lists, etc.) become proper Lexical nodes.
                editor.update(() => {
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection)) return

                    // If pasting into an empty editor, convert the whole root
                    const root = $getRoot()
                    const isEmpty =
                        root.getChildrenSize() === 1 &&
                        root.getFirstChild()?.getTextContent() === ""

                    if (isEmpty) {
                        $convertFromMarkdownString(
                            clipboardPlainText,
                            PLAYGROUND_TRANSFORMERS,
                            undefined,
                            true,
                        )
                    } else {
                        // Pasting into existing content — insert as raw text
                        // since $convertFromMarkdownString replaces root content
                        selection.insertRawText(clipboardPlainText)
                    }
                })

                return true
            },
            COMMAND_PRIORITY_HIGH,
        )
    }, [deferLargePasteUpdate, editor, setMarkdownView])

    useEffect(() => {
        return editor.registerUpdateListener(({editorState, dirtyElements, dirtyLeaves, tags}) => {
            if (tags.has(MARKDOWN_VIEW_TOGGLE_UPDATE_TAG)) {
                return
            }

            if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
                return
            }

            editorState.read(() => {
                const root = $getRoot()
                const firstChild = root.getFirstChild()
                const isCurrentlyMarkdown =
                    $isCodeNode(firstChild) && firstChild.getLanguage() === "markdown"

                if (!isCurrentlyMarkdown && markdownSourceCacheRef.current.reusable) {
                    markdownSourceCacheRef.current.reusable = false
                }
            })
        })
    }, [editor])

    useEffect(() => {
        return editor.registerUpdateListener(({editorState}) => {
            editorState.read(() => {
                const root = $getRoot()
                const children = root.getChildren()
                const markdownCodeNode = children.find(
                    (node) => $isCodeNode(node) && node.getLanguage() === "markdown",
                )

                if (!markdownCodeNode) return

                const index = children.indexOf(markdownCodeNode)
                const trailingNodes = children.slice(index + 1)

                if (trailingNodes.length > 0) {
                    editor.update(() => {
                        for (const node of trailingNodes) {
                            const content = node.getTextContent()
                            ;(markdownCodeNode as ElementNode).append(
                                $createTextNode("\n" + content),
                            )
                            node.remove()
                        }
                    })
                }
            })
        })
    }, [editor])

    // Sync markdown view atom to match the actual editor state on mount.
    // This ensures external readers (e.g. MarkdownViewState) see the correct
    // state immediately, even when the editor was hydrated with markdown content.
    useLayoutEffect(() => {
        editor.getEditorState().read(() => {
            const root = $getRoot()
            const firstChild = root.getFirstChild()
            const isMarkdown = $isCodeNode(firstChild) && firstChild.getLanguage() === "markdown"
            setMarkdownView(isMarkdown)
        })
    }, [editor, setMarkdownView])

    return (
        <>
            {!largeDocumentMode ? (
                <MarkdownShortcutPlugin transformers={PLAYGROUND_TRANSFORMERS} />
            ) : null}
            <ListPlugin />
            <CheckListPlugin />
            <TabIndentationPlugin />
            {!largeDocumentMode ? <LexicalAutoLinkPlugin /> : null}
            {!largeDocumentMode ? <ClickableLinkPlugin /> : null}
            <HorizontalRulePlugin />
            <TablePlugin />
            <LexicalLinkPlugin />
        </>
    )
}

export default MarkdownPlugin
