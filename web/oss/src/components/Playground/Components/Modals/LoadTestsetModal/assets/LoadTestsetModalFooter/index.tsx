import {memo, useCallback, useMemo} from "react"

import {Play} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import {appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {useTestsetInputsAnalysis} from "../../hooks/useTestsetInputsAnalysis"
import {LoadTestsetModalFooterProps} from "../types"

const LoadTestsetModalFooter = ({
    onClose,
    isLoadingTestset,
    selectedRowKeys,
    testsetCsvData,
    setTestsetData,
}: LoadTestsetModalFooterProps) => {
    const appUriInfo = useAtomValue(appUriInfoAtom)
    const routePath = appUriInfo?.routePath

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

    const loadTestset = useCallback(() => {
        // testsetCsvData already contains only the selected testcases (filtered by useSelectedTestcasesData hook)
        if (!testsetCsvData.length) {
            console.warn("No testcases selected")
            return
        }

        setTestsetData(testsetCsvData)
        onClose()
    }, [onClose, setTestsetData, testsetCsvData])

    return (
        <div className="flex items-center justify-end gap-2">
            <Button onClick={() => onClose()}>Cancel</Button>
            <Tooltip title={loadWarningMessage}>
                {/* Wrap disabled button with span so tooltip triggers on hover */}
                <span style={{display: "inline-block"}}>
                    <Button
                        type="primary"
                        danger={hasCompatibilityIssue}
                        icon={<Play />}
                        iconPlacement="end"
                        disabled={!selectedRowKeys.length}
                        loading={isLoadingTestset}
                        onClick={loadTestset}
                    >
                        Load testset
                    </Button>
                </span>
            </Tooltip>
        </div>
    )
}

export default memo(LoadTestsetModalFooter)
