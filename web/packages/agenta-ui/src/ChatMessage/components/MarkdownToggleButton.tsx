import {memo, useCallback} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Tooltip} from "antd"
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
        <Tooltip title={markdownView ? "Preview markdown" : "Preview text"}>
            <Button
                onClick={onToggleMarkdown}
                className={cn(flexLayouts.rowCenter, justifyClasses.center)}
                variant="ghost"
                size="icon-sm"
            >
                {markdownView ? <MarkdownLogoIcon size={14} /> : <TextAa size={14} />}
            </Button>
        </Tooltip>
    )
}

export default memo(MarkdownToggleButton)
