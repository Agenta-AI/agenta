import {memo, useCallback, useMemo, useState} from "react"

import {legacyAppRevisionEntityWithBridgeAtomFamily} from "@agenta/entities/legacyAppRevision"
import {message} from "@agenta/ui/app-message"
import {Play} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {saveNewTestsetAtom} from "@/oss/state/entities/testcase"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {useTestsetInputsAnalysis} from "../../hooks/useTestsetInputsAnalysis"
import {LoadTestsetModalFooterProps} from "../types"

const LoadTestsetModalFooter = ({
    onClose,
    isLoadingTestset,
    selectedRowKeys,
    testsetCsvData,
    setTestsetData,
    selectedRevisionId,
    isCreatingNew,
    newTestsetName,
}: LoadTestsetModalFooterProps) => {
    const entityData = useAtomValue(
        useMemo(
            () =>
                selectedRevisionId
                    ? legacyAppRevisionEntityWithBridgeAtomFamily(selectedRevisionId)
                    : atom(null),
            [selectedRevisionId],
        ),
    )
    const routePath = entityData?.routePath
    const projectId = useAtomValue(projectIdAtom)
    const saveNewTestset = useSetAtom(saveNewTestsetAtom)
    const [isSaving, setIsSaving] = useState(false)

    // High-level analysis of inputs vs testset columns, including schema + dynamic variables
    const {expectedInputVariables, hasCompatibilityIssue} = useTestsetInputsAnalysis({
        routePath,
        testsetCsvData,
    })

    const loadWarningMessage = useMemo(() => {
        if (!hasCompatibilityIssue) return undefined
        const variantList = expectedInputVariables.length ? expectedInputVariables.join(", ") : "—"

        return `The testset has no CSV columns matching the expected variables {{${variantList}}}. Loading may fail unless the variables align.`
    }, [expectedInputVariables, hasCompatibilityIssue])

    const loadTestset = useCallback(async () => {
        // If creating new, save first then load
        if (isCreatingNew) {
            if (!newTestsetName.trim()) {
                message.error("Please enter a testset name")
                return
            }

            if (!projectId) {
                message.error("Project ID not found")
                return
            }

            setIsSaving(true)
            try {
                const result = await saveNewTestset({
                    projectId,
                    testsetName: newTestsetName.trim(),
                })

                if (!result.success) {
                    message.error(result.error?.message || "Failed to save testset")
                    setIsSaving(false)
                    return
                }

                message.success("Testset created successfully")

                const newTestcases = (result.testcases ?? []) as Record<string, any>[]
                if (newTestcases.length) {
                    setTestsetData({
                        testcases: newTestcases,
                        revisionId: result.revisionId,
                    })
                } else {
                    message.info("Testset is empty. Add rows before loading.")
                }

                onClose()
            } catch (error) {
                console.error("Error creating testset:", error)
                message.error("Failed to create testset")
            } finally {
                setIsSaving(false)
            }
            return
        }

        // Regular load flow for existing testsets
        // testsetCsvData already contains only the selected testcases (filtered by useSelectedTestcasesData hook)
        if (!testsetCsvData.length) {
            console.warn("No testcases selected")
            return
        }

        setTestsetData({
            testcases: testsetCsvData as Record<string, any>[],
            revisionId: selectedRevisionId || undefined,
        })
        onClose()
    }, [
        isCreatingNew,
        newTestsetName,
        projectId,
        saveNewTestset,
        testsetCsvData,
        setTestsetData,
        selectedRevisionId,
        onClose,
    ])

    const isDisabled = isCreatingNew ? !newTestsetName.trim() : !selectedRowKeys.length

    const buttonText = isCreatingNew ? "Create & Load" : "Load testset"

    const selectionCountText =
        !isCreatingNew && selectedRowKeys.length > 0
            ? `${selectedRowKeys.length} testcase${selectedRowKeys.length === 1 ? "" : "s"} selected`
            : ""

    return (
        <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-gray-600">{selectionCountText}</div>
            <div className="flex items-center gap-2">
                <Button onClick={() => onClose()}>Cancel</Button>
                <Tooltip title={loadWarningMessage}>
                    {/* Wrap disabled button with span so tooltip triggers on hover */}
                    <span style={{display: "inline-block"}}>
                        <Button
                            type="primary"
                            danger={hasCompatibilityIssue && !isCreatingNew}
                            icon={<Play />}
                            iconPlacement="end"
                            disabled={isDisabled}
                            loading={isLoadingTestset || isSaving}
                            onClick={loadTestset}
                        >
                            {buttonText}
                        </Button>
                    </span>
                </Tooltip>
            </div>
        </div>
    )
}

export default memo(LoadTestsetModalFooter)
