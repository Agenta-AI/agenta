/**
 * InstructionsPanel - Left panel for entering refinement guidelines
 *
 * Uses @ant-design/x Bubble for conversation display, Sender for input,
 * and Prompts for predefined quick-actions.
 */

import {type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {BulbOutlined} from "@ant-design/icons"
import {Bubble, Prompts, Sender} from "@ant-design/x"
import {Spin} from "antd"
import {useAtomValue} from "jotai"

import {useRefinePrompt} from "../hooks/useRefinePrompt"
import {
    pendingGuidelinesAtomFamily,
    refineIterationsAtomFamily,
    refineLoadingAtomFamily,
} from "../store/refinePromptStore"

interface InstructionsPanelProps {
    variantId: string
    promptId: string
    submitRef: MutableRefObject<(() => void) | null>
}

const PREDEFINED_PROMPTS = [
    {
        key: "optimize",
        icon: <BulbOutlined />,
        label: "Optimize the prompt using best practices",
    },
]

const InstructionsPanel: React.FC<InstructionsPanelProps> = ({variantId, promptId, submitRef}) => {
    const [inputValue, setInputValue] = useState("")
    const scrollRef = useRef<HTMLDivElement>(null)

    const iterations = useAtomValue(refineIterationsAtomFamily(promptId))
    const isLoading = useAtomValue(refineLoadingAtomFamily(promptId))
    const pendingGuidelines = useAtomValue(pendingGuidelinesAtomFamily(promptId))

    const {refine} = useRefinePrompt({variantId, promptId})

    const scrollToBottom = useCallback(() => {
        setTimeout(() => {
            scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth",
            })
        }, 100)
    }, [])

    const handleSubmit = useCallback(
        async (message: string) => {
            const guidelines = message.trim()
            if (!guidelines || isLoading) return

            setInputValue("")
            await refine(guidelines)
            scrollToBottom()
        },
        [isLoading, refine, scrollToBottom],
    )

    // For Cmd+Enter: submit whatever is currently in the input
    const handleCmdEnterSubmit = useCallback(() => {
        const guidelines = inputValue.trim()
        if (!guidelines || isLoading) return
        handleSubmit(guidelines)
    }, [inputValue, isLoading, handleSubmit])

    // Expose submit to parent for Cmd+Enter handling
    useEffect(() => {
        submitRef.current = handleCmdEnterSubmit
        return () => {
            submitRef.current = null
        }
    }, [handleCmdEnterSubmit, submitRef])

    const handlePromptClick = useCallback(
        (info: {data: {key: string; label?: React.ReactNode}}) => {
            if (isLoading) return
            const text = typeof info.data.label === "string" ? info.data.label : ""
            if (text) {
                handleSubmit(text)
            }
        },
        [isLoading, handleSubmit],
    )

    // Memoize bubble items to avoid re-creation on every render
    const bubbleItems = useMemo(() => {
        const items: {
            key: string
            content: string
            placement: "start" | "end"
            variant?: "filled" | "outlined" | "shadow" | "borderless"
        }[] = []

        for (const iteration of iterations) {
            items.push({
                key: `${iteration.id}-guidelines`,
                content: iteration.guidelines,
                placement: "end",
                variant: "filled",
            })
            items.push({
                key: `${iteration.id}-explanation`,
                content: iteration.explanation,
                placement: "start",
                variant: "outlined",
            })
        }

        // Add pending guidelines while waiting for response
        if (pendingGuidelines) {
            items.push({
                key: "pending-guidelines",
                content: pendingGuidelines,
                placement: "end",
                variant: "filled",
            })
        }

        return items
    }, [iterations, pendingGuidelines])

    const hasContent = bubbleItems.length > 0 || isLoading

    return (
        <div className="flex h-full flex-col">
            {/* Conversation area */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
                {!hasContent ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-[rgba(5,23,41,0.45)]">
                        <div>
                            <p className="mb-1 text-[12px]">
                                Describe how you want to refine your prompt
                            </p>
                            <p className="text-[11px]">Or pick a suggestion below</p>
                        </div>
                    </div>
                ) : (
                    <Bubble.List
                        items={bubbleItems}
                        style={{fontSize: 12}}
                        roles={{
                            user: {
                                placement: "end",
                                variant: "filled",
                            },
                            assistant: {
                                placement: "start",
                                variant: "outlined",
                            },
                        }}
                    />
                )}

                {/* Loading indicator */}
                {isLoading ? (
                    <div className="mt-3 flex items-center gap-2 text-[rgba(5,23,41,0.45)]">
                        <Spin size="small" />
                        <span className="text-[11px]">Refining prompt…</span>
                    </div>
                ) : null}
            </div>

            {/* Predefined prompts + Sender input */}
            <div className="border-t border-[rgba(5,23,41,0.06)] px-3 pb-3 pt-2">
                {/* Predefined prompts */}
                <div className="mb-2">
                    <Prompts
                        items={PREDEFINED_PROMPTS}
                        onItemClick={handlePromptClick}
                        styles={{
                            item: {
                                fontSize: 11,
                                padding: "4px 10px",
                            },
                        }}
                    />
                </div>

                {/* Sender input */}
                <Sender
                    value={inputValue}
                    onChange={setInputValue}
                    onSubmit={handleSubmit}
                    placeholder="Describe how to refine your prompt…"
                    loading={isLoading}
                    disabled={isLoading}
                    style={{fontSize: 12}}
                    styles={{
                        input: {minHeight: 0, padding: "2px 0"},
                        actions: {alignSelf: "flex-end"},
                    }}
                />
            </div>
        </div>
    )
}

export default InstructionsPanel
