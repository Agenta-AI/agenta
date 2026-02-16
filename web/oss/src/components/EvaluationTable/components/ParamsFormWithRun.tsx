// @ts-nocheck
import {useMemo} from "react"

import {CaretRightOutlined} from "@ant-design/icons"
import {Button, Form} from "antd"
import {atom, useAtomValue} from "jotai"

import ParamsForm from "@/oss/components/ParamsForm"
import {useLegacyVariants} from "@/oss/lib/hooks/useLegacyVariant"
import type {Evaluation} from "@/oss/lib/Types"
import {inputParamsAtomFamily} from "@/oss/state/newPlayground/core/inputParams"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {useSingleModelEvaluationTableStyles} from "../assets/styles"
import type {SingleModelEvaluationRow} from "../types"

/**
 *
 * @param evaluation - Evaluation object
 * @param evaluationScenarios - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */
const ParamsFormWithRun = ({
    evaluation,
    record,
    rowIndex,
    onRun,
    onParamChange,
    variantData = [],
    isLoading,
}: {
    record: SingleModelEvaluationRow
    rowIndex: number
    evaluation: Evaluation
    onRun: () => void
    onParamChange: (name: string, value: any) => void
    variantData: ReturnType<typeof useLegacyVariants>
    isLoading: boolean
}) => {
    const classes = useSingleModelEvaluationTableStyles()
    const [form] = Form.useForm()
    const selectedVariant = variantData?.[0]
    const routePath = useAtomValue(appUriInfoAtom)?.routePath
    const hasRevision = Boolean(selectedVariant && (selectedVariant as any).id)
    // Memoize the atom-family selector only when we have a proper revision and route
    const inputParamsSelector = useMemo(
        () =>
            (hasRevision && routePath
                ? inputParamsAtomFamily({variant: selectedVariant as any, routePath})
                : atom<any[]>([])) as any,
        [hasRevision ? (selectedVariant as any).id : undefined, routePath],
    )
    const baseInputParams = useAtomValue(inputParamsSelector) as any[]
    // Stable variables derived from saved prompts (spec + saved parameters; no live mutations)
    const stableVariableNames = useAtomValue(
        selectedVariant?.id
            ? (stablePromptVariablesAtomFamily((selectedVariant as any).id) as any)
            : atom([]),
    ) as string[]
    const flags = useAtomValue(
        selectedVariant?.id
            ? (variantFlagsAtomFamily({revisionId: (selectedVariant as any).id}) as any)
            : atom({}),
    ) as any

    // Build input params similar to EvaluationCardView with robust fallbacks
    const testsetRow = evaluation?.testset?.csvdata?.[rowIndex] || {}
    const chatCol = evaluation?.testset?.testsetChatColumn
    const reservedKeys = new Set(["correct_answer", chatCol || ""]) as Set<string>

    const derivedInputParams = useMemo((): any[] => {
        const haveSchema = Array.isArray(baseInputParams) && baseInputParams.length > 0
        let source: any[]
        if (haveSchema) {
            source = baseInputParams
        } else if (Array.isArray(record?.inputs) && record.inputs.length > 0) {
            source = record.inputs
                .filter((ip: any) => (chatCol ? ip.input_name !== chatCol : true))
                .map((ip: any) => ({name: ip.input_name, type: "string"}))
        } else {
            source = Object.keys(testsetRow)
                .filter((k) => !reservedKeys.has(k))
                .map((k) => ({name: k, type: "string"}))
        }
        // Filter to stable variables only for non-custom apps
        if (
            !flags?.isCustom &&
            Array.isArray(stableVariableNames) &&
            stableVariableNames.length > 0
        ) {
            const allow = new Set(
                stableVariableNames.filter((name) => (chatCol ? name !== chatCol : true)),
            )
            source = (source || []).filter((p: any) => allow.has(p?.name))
        }

        return (source || []).map((item: any) => ({
            ...item,
            value:
                record?.inputs?.find((ip: any) => ip.input_name === item.name)?.input_value ??
                (testsetRow as any)?.[item.name] ??
                "",
        }))
    }, [baseInputParams, record?.inputs, testsetRow, chatCol, stableVariableNames, flags?.isCustom])

    return isLoading ? null : (
        <div>
            <div className="max-w-[300px] overflow-y-auto max-h-[300px]">
                {evaluation.testset.testsetChatColumn && (
                    <div className="mb-2">
                        {evaluation.testset.csvdata[rowIndex][
                            evaluation.testset.testsetChatColumn
                        ] || " - "}
                    </div>
                )}
                {derivedInputParams && derivedInputParams.length > 0 ? (
                    <ParamsForm
                        isChatVariant={false}
                        onParamChange={onParamChange}
                        inputParams={derivedInputParams || []}
                        onFinish={(values) => {
                            // Ensure local row inputs are updated before invoking run
                            Object.entries(values || {}).forEach(([k, v]) =>
                                onParamChange(k as string, v),
                            )
                            onRun()
                        }}
                        key={`${record.id}-${rowIndex}`}
                        form={form}
                    />
                ) : null}
            </div>
            <div className={classes.inputTestBtn}>
                <Button
                    onClick={evaluation.testset.testsetChatColumn ? onRun : form.submit}
                    icon={<CaretRightOutlined />}
                >
                    Run
                </Button>
            </div>
        </div>
    )
}

export default ParamsFormWithRun
