import {memo, useCallback} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtom} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "../../Editor/plugins/markdown/commands"
import {markdownViewAtom} from "../../Editor/state/assets/atoms"
import {cn, flexLayouts, justifyClasses} from "../../utils/styles"

interface MarkdownToggleButtonProps {
    id: string
}

const MarkdownToggleButton = ({id}: MarkdownToggleButtonProps) => {
    const [editor] = useLexicalComposerContext()
    const [markdownView] = useAtom(markdownViewAtom(id))

    const onToggleMarkdown = useCallback(() => {
        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
    }, [editor])

    return (
        <Tooltip title={markdownView ? "Preview text" : "Preview markdown"}>
            <Button
                type="text"
                size="small"
                icon={markdownView ? <TextAa size={14} /> : <MarkdownLogoIcon size={14} />}
                onClick={onToggleMarkdown}
                className={cn(flexLayouts.rowCenter, justifyClasses.center)}
            />
        </Tooltip>
    )
}

export default memo(MarkdownToggleButton)
