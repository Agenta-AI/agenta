import {memo, useCallback} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {Button} from "../../components/ui/button"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../components/ui/tooltip"
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
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onToggleMarkdown}
                        className={cn(flexLayouts.rowCenter, justifyClasses.center)}
                    >
                        {markdownView ? <MarkdownLogoIcon size={14} /> : <TextAa size={14} />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {markdownView ? "Preview markdown" : "Preview text"}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export default memo(MarkdownToggleButton)
