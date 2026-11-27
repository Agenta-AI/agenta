import {memo, useCallback} from "react"

import {useT} from "@agenta/i18n"
import uiChatCatalog from "@agenta/i18n/catalogs/ui.chat"
import {Button} from "@agenta/ui/ui"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "../../editor/plugins/markdown/commands"
import {markdownViewAtom} from "../../editor/state/assets/atoms"

interface MarkdownToggleButtonProps {
    id: string
}

const MarkdownToggleButton = ({id}: MarkdownToggleButtonProps) => {
    const t = useT(uiChatCatalog)
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
                        className="flex items-center justify-center"
                    >
                        {markdownView ? <MarkdownLogoIcon size={14} /> : <TextAa size={14} />}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {markdownView ? t("ui.chat.previewMarkdown") : t("ui.chat.previewText")}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export default memo(MarkdownToggleButton)
