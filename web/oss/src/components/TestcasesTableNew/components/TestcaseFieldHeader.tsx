import {memo, useCallback, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {Copy, Check, MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtom} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import {markdownViewAtom} from "@/oss/components/Editor/state/assets/atoms"

interface TestcaseFieldHeaderProps {
    id: string
    value?: string
    hideMarkdownToggle?: boolean
}

const TestcaseFieldHeader = ({
    id,
    value = "",
    hideMarkdownToggle = false,
}: TestcaseFieldHeaderProps) => {
    const [editor] = useLexicalComposerContext()
    const [markdownView] = useAtom(markdownViewAtom(id))
    const [isCopied, setIsCopied] = useState(false)

    const onCopyText = useCallback(() => {
        if (value) {
            setIsCopied(true)
            navigator.clipboard.writeText(value)
            setTimeout(() => {
                setIsCopied(false)
            }, 1000)
        }
    }, [value])

    const onToggleMarkdown = useCallback(() => {
        editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
    }, [editor])

    return (
        <div className="flex items-center justify-end gap-1 w-full">
            <Tooltip title={isCopied ? "Copied" : "Copy"}>
                <Button
                    type="text"
                    size="small"
                    icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={onCopyText}
                    className="flex items-center justify-center"
                />
            </Tooltip>

            {!hideMarkdownToggle && (
                <Tooltip title={markdownView ? "Preview text" : "Preview markdown"}>
                    <Button
                        type="text"
                        size="small"
                        icon={markdownView ? <TextAa size={14} /> : <MarkdownLogoIcon size={14} />}
                        onClick={onToggleMarkdown}
                        className="flex items-center justify-center"
                    />
                </Tooltip>
            )}
        </div>
    )
}

export default memo(TestcaseFieldHeader)
