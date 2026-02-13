/**
 * RefinePromptModalContent - Two-panel layout for prompt refinement
 *
 * Left panel: Instructions input with conversation-like bubble display
 * Right panel: Refined prompt preview with diff toggle
 *
 * Layout follows the Figma design:
 * - Left: "Instructions" header + bubbles + input at bottom
 * - Right: "Refine prompt" header with diff toggle + close + content + footer
 */

import {useCallback, useEffect, useRef} from "react"

import {getMetadataLazy, type ArrayMetadata} from "@agenta/entities/legacyAppRevision"
import {generateId} from "@agenta/shared/utils"
import {CloseOutlined} from "@ant-design/icons"
import {Button, Switch, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import {
    refineDiffViewAtomFamily,
    refineIterationsAtomFamily,
    workingPromptVersionAtomFamily,
    workingPromptAtomFamily,
} from "../store/refinePromptStore"

import InstructionsPanel from "./InstructionsPanel"
import PreviewPanel from "./PreviewPanel"

interface RefinePromptModalContentProps {
    variantId: string
    promptId: string
    onClose: () => void
}

const RefinePromptModalContent: React.FC<RefinePromptModalContentProps> = ({
    variantId,
    promptId,
    onClose,
}) => {
    const iterations = useAtomValue(refineIterationsAtomFamily(promptId))
    const workingPrompt = useAtomValue(workingPromptAtomFamily(promptId))
    const promptVersion = useAtomValue(workingPromptVersionAtomFamily(promptId))
    const [showDiff, setShowDiff] = useAtom(refineDiffViewAtomFamily(promptId))
    const setPrompts = useSetAtom(moleculeBackedPromptsAtomFamily(variantId))

    const hasRefinedPrompt = workingPrompt !== null && iterations.length > 0

    // Ref to allow InstructionsPanel to trigger refine via Cmd+Enter
    const submitRef = useRef<(() => void) | null>(null)

    // Cmd+Enter handler scoped to modal — only swallow the event when submit proceeds
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && submitRef.current) {
                submitRef.current()
                e.preventDefault()
                e.stopPropagation()
            }
        }
        document.addEventListener("keydown", handler, {capture: true})
        return () => document.removeEventListener("keydown", handler, {capture: true})
    }, [])

    const handleUseRefinedPrompt = useCallback(() => {
        if (!workingPrompt) return

        setPrompts((draft: any[]) => {
            for (const prompt of draft) {
                if (prompt?.__id !== promptId && prompt?.__name !== promptId) continue

                const existingMessages = Array.isArray(prompt?.messages?.value)
                    ? prompt.messages.value
                    : []
                const messagesMetadataId = prompt?.messages?.__metadata as string | undefined
                const parentMetadata = messagesMetadataId
                    ? getMetadataLazy<ArrayMetadata>(messagesMetadataId)
                    : undefined
                const itemMetadata = parentMetadata?.itemMetadata

                prompt.messages.value = workingPrompt.messages.map((msg, index) => {
                    if (itemMetadata) {
                        const created = createMessageFromSchema(itemMetadata as any, {
                            role: msg.role,
                            content: msg.content,
                        })
                        if (created) return created
                    }

                    const existing = existingMessages[index]

                    return {
                        ...(existing && typeof existing === "object" ? existing : {}),
                        __id: existing?.__id || generateId(),
                        role:
                            existing?.role && typeof existing.role === "object"
                                ? {
                                      ...existing.role,
                                      value: msg.role,
                                  }
                                : {
                                      __id: generateId(),
                                      value: msg.role,
                                  },
                        content:
                            existing?.content && typeof existing.content === "object"
                                ? {
                                      ...existing.content,
                                      value: msg.content,
                                  }
                                : {
                                      __id: generateId(),
                                      value: msg.content,
                                  },
                    }
                })
            }
        })

        onClose()
    }, [workingPrompt, promptId, setPrompts, onClose])

    return (
        <div className="flex h-full min-h-0 flex-1">
            {/* Left Panel - Instructions */}
            <div className="flex min-h-0 w-1/2 flex-col border-r border-[rgba(5,23,41,0.06)]">
                {/* Left Header */}
                <div className="border-b border-[rgba(5,23,41,0.06)] px-4 py-3">
                    <Typography.Text strong className="text-[13px]">
                        Instructions
                    </Typography.Text>
                    <Typography.Text type="secondary" className="mt-0.5 block text-[11px]">
                        Chat with an LLM agent to improve your prompt
                    </Typography.Text>
                </div>

                {/* Left Content + Input */}
                <div className="flex min-h-0 flex-1 flex-col">
                    <InstructionsPanel
                        variantId={variantId}
                        promptId={promptId}
                        submitRef={submitRef}
                    />
                </div>
            </div>

            {/* Right Panel - Preview */}
            <div className="flex min-h-0 w-1/2 flex-col">
                {/* Right Header */}
                <div className="flex items-center justify-between border-b border-[rgba(5,23,41,0.06)] px-4 py-3">
                    <Typography.Text strong className="text-[13px]">
                        Refine prompt
                    </Typography.Text>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <Typography.Text type="secondary" className="text-[11px]">
                                Diff
                            </Typography.Text>
                            <Switch
                                size="small"
                                checked={showDiff}
                                onChange={setShowDiff}
                                disabled={!hasRefinedPrompt}
                                aria-label="Toggle diff view"
                            />
                        </div>
                        <Button
                            type="text"
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={onClose}
                            aria-label="Close modal"
                            className="flex items-center justify-center"
                        />
                    </div>
                </div>

                {/* Right Content */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {hasRefinedPrompt ? (
                        <PreviewPanel
                            variantId={variantId}
                            promptId={promptId}
                            promptVersion={promptVersion}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center px-4">
                            <Typography.Text type="secondary" className="text-center text-[11px]">
                                Submit instructions to see the refined prompt
                            </Typography.Text>
                        </div>
                    )}
                </div>

                {/* Right Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-[rgba(5,23,41,0.06)] px-4 py-3">
                    <Button size="small" type="text" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        size="small"
                        type="primary"
                        onClick={handleUseRefinedPrompt}
                        disabled={!hasRefinedPrompt}
                    >
                        Use refined prompt
                    </Button>
                </div>
            </div>
        </div>
    )
}

export default RefinePromptModalContent
