import {memo, useCallback} from "react"

import {TOGGLE_MARKDOWN_VIEW, markdownViewAtom} from "@agenta/ui/editor"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtom} from "jotai"

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
                className="flex items-center justify-center"
            />
        </Tooltip>
    )
}

export default memo(MarkdownToggleButton)
