import {memo, useCallback} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtom} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import {markdownViewAtom} from "@/oss/components/Editor/state/assets/atoms"

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
