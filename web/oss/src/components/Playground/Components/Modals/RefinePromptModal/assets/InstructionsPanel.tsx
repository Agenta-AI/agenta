/**
 * InstructionsPanel - Left panel for entering refinement guidelines.
 *
 * The conversation renders with the shared `ChatBubble` chrome; the quick-action chip and the
 * guideline composer are small local pieces (Enter sends, Shift+Enter breaks the line) — the
 * previous @ant-design/x Bubble/Prompts/Sender trio without the extra dependency.
 */

import {type MutableRefObject, useCallback, useEffect, useRef, useState} from "react"

import {ChatBubble} from "@agenta/ui/components/presentational"
import {Lightbulb, PaperPlaneRight} from "@phosphor-icons/react"
import {Spin} from "antd"
import {useAtomValue} from "jotai"

import {useRefinePrompt} from "../hooks/useRefinePrompt"
import {
    pendingGuidelinesAtomFamily,
    refineIterationsAtomFamily,
    refineLoadingAtomFamily,
} from "../store/refinePromptStore"

interface InstructionsPanelProps {
    revisionId: string
    promptKey: string
    submitRef: MutableRefObject<(() => void) | null>
}

const OPTIMIZE_PROMPT = "Optimize the prompt using best practices"

const InstructionsPanel: React.FC<InstructionsPanelProps> = ({
    revisionId,
    promptKey,
    submitRef,
}) => {
    const [inputValue, setInputValue] = useState("")
    const scrollRef = useRef<HTMLDivElement>(null)

    const iterations = useAtomValue(refineIterationsAtomFamily(promptKey))
    const isLoading = useAtomValue(refineLoadingAtomFamily(promptKey))
    const pendingGuidelines = useAtomValue(pendingGuidelinesAtomFamily(promptKey))

    const {refine} = useRefinePrompt({revisionId, promptKey})

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

    const hasContent = iterations.length > 0 || !!pendingGuidelines || isLoading

    return (
        <div className="flex h-full flex-col">
            {/* Conversation area */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
                {!hasContent ? (
                    <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-[var(--ag-rgba-051729-45)]">
                        <div>
                            <p className="mb-1 text-[12px]">
                                Describe how you want to refine your prompt
                            </p>
                            <p className="text-xs">Or pick a suggestion below</p>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {iterations.map((iteration) => (
                            <div key={iteration.id} className="flex flex-col gap-3">
                                <ChatBubble
                                    placement="end"
                                    variant="filled"
                                    className="justify-end"
                                    classNames={{content: "!text-xs whitespace-pre-wrap"}}
                                    content={iteration.guidelines}
                                />
                                <ChatBubble
                                    placement="start"
                                    variant="outlined"
                                    classNames={{content: "!text-xs whitespace-pre-wrap"}}
                                    content={iteration.explanation}
                                />
                            </div>
                        ))}
                        {pendingGuidelines ? (
                            <ChatBubble
                                placement="end"
                                variant="filled"
                                className="justify-end"
                                classNames={{content: "!text-xs whitespace-pre-wrap"}}
                                content={pendingGuidelines}
                            />
                        ) : null}
                    </div>
                )}

                {/* Loading indicator */}
                {isLoading ? (
                    <div className="mt-3 flex items-center gap-2 text-[var(--ag-rgba-051729-45)]">
                        <Spin size="small" />
                        <span className="text-xs">Refining prompt…</span>
                    </div>
                ) : null}
            </div>

            {/* Predefined prompt + composer */}
            <div className="border-t border-[var(--ag-rgba-051729-06)] px-3 pb-3 pt-2">
                <div className="mb-2">
                    <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleSubmit(OPTIMIZE_PROMPT)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-2.5 py-1 text-[11px] text-colorTextSecondary transition-colors hover:bg-colorFillTertiary hover:text-colorText disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Lightbulb size={12} />
                        {OPTIMIZE_PROMPT}
                    </button>
                </div>

                <div className="flex items-end gap-1.5 rounded-lg border border-solid border-colorBorder bg-colorBgContainer px-2.5 py-1.5 focus-within:border-colorPrimary">
                    <textarea
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                            // Let the IME keep the Enter that confirms a composition candidate
                            // (CJK, etc.) — intercepting it would submit a half-written guideline.
                            if (e.nativeEvent.isComposing) return

                            // Enter sends; Shift+Enter breaks the line (the Sender's contract).
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault()
                                handleSubmit(inputValue)
                            }
                        }}
                        placeholder="Describe how to refine your prompt…"
                        disabled={isLoading}
                        rows={2}
                        className="min-w-0 flex-1 resize-none border-0 bg-transparent p-0 py-0.5 text-xs text-colorText outline-none placeholder:text-colorTextQuaternary"
                    />
                    <button
                        type="button"
                        aria-label="Send"
                        disabled={isLoading || !inputValue.trim()}
                        onClick={() => handleSubmit(inputValue)}
                        className="flex size-6 shrink-0 cursor-pointer items-center justify-center self-end rounded-full border-0 bg-colorPrimary text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {isLoading ? <Spin size="small" /> : <PaperPlaneRight size={13} />}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default InstructionsPanel
