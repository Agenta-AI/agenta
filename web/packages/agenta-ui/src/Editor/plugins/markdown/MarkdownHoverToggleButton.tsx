import {memo, useCallback} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {markdownViewAtom} from "../../state/assets/atoms"

import {TOGGLE_MARKDOWN_VIEW} from "./commands"

interface MarkdownHoverToggleButtonProps {
    id: string
}

const MarkdownHoverToggleButton = ({id}: MarkdownHoverToggleButtonProps) => {
    const [editor] = useLexicalComposerContext()
    const markdownView = useAtomValue(markdownViewAtom(id))

    const onToggleMarkdown = useCallback(() => {
        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
    }, [editor])

    return (
        <div
            className={clsx(
                "absolute z-10 opacity-0 transition-opacity",
                "group-hover/item:opacity-100 focus-within:opacity-100",
            )}
            style={{top: 8, right: 36}}
        >
            <Tooltip title={markdownView ? "Preview text" : "Preview markdown"}>
                <Button onClick={onToggleMarkdown} variant="ghost" size="icon-sm">
                    {markdownView ? <TextAa size={14} /> : <MarkdownLogoIcon size={14} />}
                </Button>
            </Tooltip>
        </div>
    )
}

export default memo(MarkdownHoverToggleButton)
