/**
 * SaveTestsetPanel Component
 *
 * Panel for save mode - displays loadable data and allows naming the new testset.
 * Reads and writes directly to loadable entity state via loadableController.
 *
 * Uses the same left/right layout as the OSS LoadTestsetModal:
 * - Left panel: Name input and commit message
 * - Right panel: IVT table preview of testcases
 */

import {useCallback, useMemo, useState} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {
    NumberedStep,
    PanelFooter,
    SplitPanelLayout,
    StepContainer,
} from "@agenta/ui/components/presentational"
import {cn, layoutSizes, textColors, textSizes} from "@agenta/ui/styles"
import {Button, Empty, Input, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {LoadableDataTable} from "./LoadableDataTable"

const {Text} = Typography

// ============================================================================
// TYPES
// ============================================================================

export interface SaveTestsetPanelProps {
    /** Loadable ID to read data from */
    loadableId: string
    /** Called when save is confirmed (commit message only - name is in entity state) */
    onSave: (commitMessage?: string) => void
    /** Called when cancelled */
    onCancel: () => void
    /** Whether save is in progress */
    isSaving?: boolean
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function SaveTestsetPanel({
    loadableId,
    onSave,
    onCancel,
    isSaving = false,
}: SaveTestsetPanelProps) {
    const [commitMessage, setCommitMessage] = useState("")

    // Read name from loadable entity state (initialized by SaveModeContent)
    const nameAtom = useMemo(() => loadableController.selectors.name(loadableId), [loadableId])
    const entityName = useAtomValue(nameAtom)

    // Set name action - mutates entity state
    const setName = useSetAtom(loadableController.actions.setName)

    // Handle name change - update entity state
    const handleNameChange = useCallback(
        (value: string) => {
            setName(loadableId, value)
        },
        [loadableId, setName],
    )

    // Read rows directly from loadable entity
    const rowsAtom = useMemo(() => loadableController.selectors.rows(loadableId), [loadableId])
    const rows = useAtomValue(rowsAtom) as {id: string; data: Record<string, unknown>}[]

    // Handle save - name is already in entity state
    const handleSave = useCallback(() => {
        if (!entityName?.trim()) return
        onSave(commitMessage.trim() || undefined)
    }, [entityName, commitMessage, onSave])

    // No data
    if (!rows || rows.length === 0) {
        return (
            <div className="flex flex-col h-full">
                <div className="flex-1 flex items-center justify-center">
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No testcases to save"
                    />
                </div>
                <PanelFooter>
                    <Button onClick={onCancel}>Cancel</Button>
                </PanelFooter>
            </div>
        )
    }

    return (
        <div className="w-full flex flex-col h-full min-h-0 overflow-hidden">
            {/* Main content - left/right layout */}
            <SplitPanelLayout
                leftWidth={layoutSizes.sidebarNarrow}
                left={
                    <StepContainer>
                        {/* Step 1: Name input */}
                        <NumberedStep number={1} title="Name new testset">
                            <Input
                                placeholder="e.g. onboarding_prompts"
                                value={entityName || ""}
                                onChange={(e) => handleNameChange(e.target.value)}
                                autoFocus
                            />
                        </NumberedStep>

                        {/* Step 2: Preview info */}
                        <NumberedStep number={2} title="Review testcases">
                            <Text
                                className={cn(
                                    textSizes.xs,
                                    "leading-relaxed",
                                    textColors.secondary,
                                )}
                            >
                                {rows.length} testcase{rows.length !== 1 ? "s" : ""} will be saved
                                to the new testset.
                            </Text>
                        </NumberedStep>

                        {/* Step 3: Commit message */}
                        <NumberedStep number={3} title="Commit message" subtitle="(optional)">
                            <Input.TextArea
                                placeholder="e.g. Initial testset creation"
                                value={commitMessage}
                                onChange={(e) => setCommitMessage(e.target.value)}
                                rows={3}
                            />
                        </NumberedStep>
                    </StepContainer>
                }
                right={<LoadableDataTable loadableId={loadableId} />}
            />

            {/* Footer */}
            <PanelFooter>
                <Button onClick={onCancel} disabled={isSaving}>
                    Cancel
                </Button>
                <Button
                    type="primary"
                    onClick={handleSave}
                    disabled={!entityName?.trim() || rows.length === 0}
                    loading={isSaving}
                >
                    Create & Load
                </Button>
            </PanelFooter>
        </div>
    )
}

export default SaveTestsetPanel
