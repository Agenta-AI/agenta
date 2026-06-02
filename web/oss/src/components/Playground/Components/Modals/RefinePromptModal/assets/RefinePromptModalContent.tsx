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

import {useCallback, useEffect, useMemo, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {CloseOutlined} from "@ant-design/icons"
import {Button, Switch, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {
    refineDiffViewAtomFamily,
    refineIterationsAtomFamily,
    workingPromptVersionAtomFamily,
    workingPromptAtomFamily,
} from "../store/refinePromptStore"

import InstructionsPanel from "./InstructionsPanel"
import PreviewPanel from "./PreviewPanel"

interface RefinePromptModalContentProps {
    revisionId: string
    promptKey: string
    onClose: () => void
}

const RefinePromptModalContent: React.FC<RefinePromptModalContentProps> = ({
    revisionId,
    promptKey,
    onClose,
}) => {
    const iterations = useAtomValue(refineIterationsAtomFamily(promptKey))
    const workingPrompt = useAtomValue(workingPromptAtomFamily(promptKey))
    const promptVersion = useAtomValue(workingPromptVersionAtomFamily(promptKey))
    const [showDiff, setShowDiff] = useAtom(refineDiffViewAtomFamily(promptKey))

    const configurationAtom = useMemo(
        () => workflowMolecule.selectors.configuration(revisionId),
        [revisionId],
    )
    const configuration = useAtomValue(configurationAtom)

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

    const setUpdate = useSetAtom(workflowMolecule.actions.updateConfiguration)

    const handleUseRefinedPrompt = useCallback(() => {
        if (!workingPrompt || !configuration) return

        const config = (configuration ?? {}) as Record<string, unknown>
        const currentPrompt = (config[promptKey] ?? {}) as Record<string, unknown>

        // Snapshot the refined config once. We write it TWICE: the first
        // write applies the refinement immediately, the second runs after
        // the chat-message editor's `useDebounceInput` window (300ms in
        // SharedEditor) so any in-flight debounced emit from the user's
        // pre-refine typing can't revert the refined messages back to
        // whatever was in the editor's buffer.
        //
        // Why the second write is necessary (reproduced in production):
        // when the user edits a message before opening the refiner, the
        // chat editor's `useDebounceInput` schedules a deferred onChange
        // call at typing+300ms. The sync effect SHOULD cancel that timer
        // when the controlled value changes via our first write, but in
        // practice the cancellation races with two other paths:
        //   1. The Lexical editor's own onChange fires AFTER hydration with
        //      the freshly-hydrated text — propagating up through
        //      `PromptSchemaControl.handleMessagesChange` which closes over
        //      the post-refine `value`. If the editor produces text that
        //      doesn't byte-match the refined source (markdown normalisation,
        //      whitespace, escape stripping), this emits a new write that
        //      OVERWRITES our refined messages with the editor's stale
        //      buffer + post-hydration normalisation.
        //   2. The handler chain serialises through several memoised
        //      callbacks (`handleMessagesChange`, `MessagesSchemaControl`'s
        //      `handleChange`, etc.). Each captures `value` via deps. If any
        //      callback in the chain hasn't re-created with the post-refine
        //      `value` yet when the debounced emit fires, the spread
        //      `{...value, messages: TYPED}` writes the user's pre-refine
        //      content back over the refinement.
        //
        // A 400ms re-write covers the 300ms debounce window plus React
        // batching slack. The second write is a no-op when nothing
        // reverted (same params → `updateConfigurationAtom` writes the
        // same draft state; no observable churn).
        const refinedConfig = {
            ...config,
            [promptKey]: {
                ...currentPrompt,
                messages: workingPrompt.messages,
            },
        }

        setUpdate(revisionId, refinedConfig)
        onClose()

        const timer = setTimeout(() => {
            setUpdate(revisionId, refinedConfig)
        }, 400)
        revertGuardTimerRef.current = timer
    }, [workingPrompt, configuration, promptKey, revisionId, onClose, setUpdate])

    // Clean up the revert-guard timer if the modal unmounts before it fires
    // (e.g. user navigates away). Without this, a late refire would attempt
    // to write to an unmounted revision.
    const revertGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
        return () => {
            if (revertGuardTimerRef.current !== null) {
                clearTimeout(revertGuardTimerRef.current)
                revertGuardTimerRef.current = null
            }
        }
    }, [])

    return (
        <div className="flex h-full min-h-0 flex-1">
            {/* Left Panel - Instructions */}
            <div className="flex min-h-0 w-1/2 flex-col border-r border-[var(--ag-rgba-051729-06)]">
                {/* Left Header */}
                <div className="border-b border-[var(--ag-rgba-051729-06)] px-4 py-3">
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
                        revisionId={revisionId}
                        promptKey={promptKey}
                        submitRef={submitRef}
                    />
                </div>
            </div>

            {/* Right Panel - Preview */}
            <div className="flex min-h-0 w-1/2 flex-col">
                {/* Right Header */}
                <div className="flex items-center justify-between border-b border-[var(--ag-rgba-051729-06)] px-4 py-3">
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
                        <PreviewPanel promptKey={promptKey} promptVersion={promptVersion} />
                    ) : (
                        <div className="flex h-full items-center justify-center px-4">
                            <Typography.Text type="secondary" className="text-center text-[11px]">
                                Submit instructions to see the refined prompt
                            </Typography.Text>
                        </div>
                    )}
                </div>

                {/* Right Footer */}
                <div className="flex items-center justify-end gap-2 border-t border-[var(--ag-rgba-051729-06)] px-4 py-3">
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
