import {useEffect, useCallback} from "react"
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
    $getSelection,
    $isRangeSelection,
    COMMAND_PRIORITY_HIGH,
    type ElementNode,
} from "lexical"

import {markdownViewAtom} from "../../state/assets/atoms"

import {$convertToMarkdownStringCustom, PLAYGROUND_TRANSFORMERS} from "./assets/transformers"
import {TOGGLE_MARKDOWN_VIEW} from "./commands"

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

const MarkdownPlugin = ({id}: {id: string}) => {
    const [, setMarkdownView] = useAtom(markdownViewAtom(id))
    const [editor] = useLexicalComposerContext()

    const handleMarkdownToggle = useCallback(() => {
        editor.update(() => {
            const root = $getRoot()
            const firstChild = root.getFirstChild()
            if ($isCodeNode(firstChild) && firstChild.getLanguage() === "markdown") {
                $convertFromMarkdownString(
                    firstChild.getTextContent(),
                    PLAYGROUND_TRANSFORMERS,
                    undefined,
                    true,
                )
                setMarkdownView(false)
            } else {
                const markdown = $convertToMarkdownStringCustom(
                    PLAYGROUND_TRANSFORMERS,
                    undefined,
                    true,
                )
                const codeNode = $createCodeNode("markdown")
                codeNode.append($createTextNode(markdown))
                root.clear().append(codeNode)
                codeNode.selectStart()
                setMarkdownView(true)
            }
        })
    }, [editor, setMarkdownView])

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

    return (
        <>
            <MarkdownShortcutPlugin transformers={PLAYGROUND_TRANSFORMERS} />
            <ListPlugin />
            <CheckListPlugin />
            <TabIndentationPlugin />
            <LexicalAutoLinkPlugin />
            <ClickableLinkPlugin />
            <HorizontalRulePlugin />
            <TablePlugin />
            <LexicalLinkPlugin />
        </>
    )
}

export default MarkdownPlugin
