import {HTMLProps, memo, useMemo} from "react"

import {ArrowsOut} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import {loadable} from "jotai/utils"
import JSON5 from "json5"
import dynamic from "next/dynamic"

import TooltipButton from "@/oss/components/Playground/assets/EnhancedButton"
import {Expandable} from "@/oss/components/Tables/ExpandableCell"
import {useOptionalRunId, useRunId} from "@/oss/contexts/RunIdContext"
import {scenarioStepFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"
import {resolvePath} from "@/oss/lib/workers/evalRunner/pureEnrichment"
import {useAppNavigation, useAppState} from "@/oss/state/appState"

import {evalAtomStore} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/store"
import {renderChatMessages} from "../../../assets/renderChatMessages"
import {evalTypeAtom} from "../../../state/evalType"
import {TableRow} from "../types"

const SharedEditor = dynamic(() => import("@/oss/components/Playground/Components/SharedEditor"), {
    ssr: false,
    loading: () => <div className="w-full min-h-[70px]" />,
})
const GenerationResultUtils = dynamic(
    () =>
        import(
            "@agenta/oss/src/components/Playground/Components/PlaygroundGenerations/assets/GenerationResultUtils"
        ),
    {ssr: false, loading: () => <div className="h-[24.4px] w-full" />},
)
const StatusCell = dynamic(() => import("./StatusCell"), {
    ssr: false,
    loading: () => <div className="h-[24.4px] w-[30px]" />,
})

export const CellWrapper = memo(({children, className}: HTMLProps<HTMLDivElement>) => {
    return (
        <div
            className={clsx([
                "w-full h-full",
                "flex items-start",
                "bg-inherit",
                "overflow-hidden",
                "group",
                className,
            ])}
        >
            {children}
        </div>
    )
})

export const InputCell = memo(
    ({
        scenarioId,
        inputKey,
        stepKey,
        showEditor = true,
        disableExpand = false,
        runId,
    }: {
        scenarioId: string
        inputKey: string
        stepKey?: string
        showEditor?: boolean
        disableExpand?: boolean
        runId?: string
    }) => {
        // Use effective runId with proper fallback logic
        const contextRunId = useRunId()
        const effectiveRunId = useMemo(() => {
            if (runId) return runId
            if (contextRunId) return contextRunId
            // No fallback to getCurrentRunId() - component should not render without valid runId
            return null
        }, [runId, contextRunId])

        // Use global store for multi-run support like InvocationInputs
        // Only access atoms if we have a valid runId
        const stepLoadable = useAtomValue(
            effectiveRunId
                ? loadable(scenarioStepFamily({scenarioId, runId: effectiveRunId}))
                : atom({state: "loading" as const}),
        )
        if (stepLoadable.state !== "hasData" || !stepLoadable.data)
            return (
                <CellWrapper>
                    <span className="text-gray-400">—</span>
                </CellWrapper>
            )
        const enrichedArr = stepLoadable.data?.inputSteps ?? []
        let targetStep = stepKey ? enrichedArr.find((s) => s.stepKey === stepKey) : undefined
        if (!targetStep) targetStep = stepLoadable.data?.inputStep ?? enrichedArr[0]

        let val: any
        if (targetStep && (targetStep as any).inputs) {
            let _inputs = {}
            try {
                const {testcase_dedup_id, ...rest} = targetStep.testcase.data
                _inputs = {...(targetStep as any).inputs, ...rest}
            } catch (e) {
                _inputs = {}
            }

            const inputs = {..._inputs}
            const groundTruth = (targetStep as any).groundTruth ?? {}
            // Merge like InvocationInputs: groundTruth first, then inputs override duplicates
            const merged = {...groundTruth, ...inputs}
            const path = inputKey.startsWith("data.") ? inputKey.slice(5) : inputKey
            val = resolvePath(merged, path)
        }

        // Use shared util for complex chat messages, otherwise primitive display
        let isChat = false
        let reactNodes: React.ReactNode[] | undefined
        if (typeof val === "string") {
            try {
                const parsed = JSON.parse(val)
                isChat =
                    Array.isArray(parsed) && parsed.every((m: any) => "role" in m && "content" in m)
            } catch {
                /* ignore */
            }
        }
        if (isChat) {
            reactNodes = renderChatMessages({
                keyPrefix: `${scenarioId}-${inputKey}`,
                rawJson: val as string,
                view: "table",
            })
        }

        return (
            <CellWrapper>
                <Expandable
                    disableExpand={disableExpand}
                    expandKey={scenarioId}
                    className={clsx([
                        "[&_.agenta-shared-editor]:hover:!border-transparent",
                        {
                            "[&_.agenta-shared-editor]:p-0": !reactNodes,
                        },
                    ])}
                >
                    {reactNodes ? (
                        <div className="flex flex-col gap-2 w-full">{reactNodes}</div>
                    ) : val != null && val !== "" && !showEditor ? (
                        <div>{String(val)}</div>
                    ) : val != null && val !== "" ? (
                        <SharedEditor
                            handleChange={() => {}}
                            initialValue={String(val)}
                            editorType="borderless"
                            placeholder="Click the 'Run' icon to get variant output"
                            disabled
                            editorClassName="!text-xs"
                            editorProps={{enableResize: true}}
                        />
                    ) : (
                        <span>N/A</span>
                    )}
                </Expandable>
            </CellWrapper>
        )
    },
)

// Dynamic invocation result cell for run-index driven columns
export const InvocationResultCellSkeleton = memo(() => {
    return (
        <CellWrapper className="flex flex-col !items-start justify-between gap-2 text-wrap"></CellWrapper>
    )
})

export const InvocationResultCell = memo(
    ({
        scenarioId,
        stepKey,
        path,
        isSkeleton,
        runId,
        record,
    }: {
        isSkeleton: boolean
        scenarioId: string
        stepKey: string
        path: string
        runId?: string // Optional for multi-run support
        record?: TableRow
    }) => {
        const {trace, value, messageNodes, hasError} = useInvocationResult({
            scenarioId,
            stepKey,
            runId,
            viewType: "table",
        })
        const evalType = useAtomValue(evalTypeAtom)
        const navigation = useAppNavigation()
        const appState = useAppState()
        const contextRunId = useOptionalRunId()

        const handleOpenFocus = () => {
            const targetRunId = runId ?? contextRunId ?? null
            if (!targetRunId) {
                console.warn("[InvocationResultCell] Missing runId while opening focus view", {
                    scenarioId,
                })
                return
            }

            const currentScenarioValue = appState.query?.focusScenarioId
            const currentRunValue = appState.query?.focusRunId
            const scenarioMatches = Array.isArray(currentScenarioValue)
                ? currentScenarioValue[0] === scenarioId
                : currentScenarioValue === scenarioId
            const runMatches = Array.isArray(currentRunValue)
                ? currentRunValue[0] === targetRunId
                : currentRunValue === targetRunId

            if (!scenarioMatches || !runMatches) {
                navigation.patchQuery(
                    {
                        focusScenarioId: scenarioId,
                        focusRunId: targetRunId,
                    },
                    {shallow: true},
                )
            }
        }

        return (
            <CellWrapper className="flex flex-col !items-start justify-between gap-2 text-wrap">
                {!isSkeleton && evalType === "auto" ? (
                    <TooltipButton
                        icon={<ArrowsOut size={14} className="ml-[1px] mt-[1px]" />}
                        size="small"
                        className="absolute top-2 right-2 z-[2] hidden group-hover:block"
                        onClick={handleOpenFocus}
                        tooltipProps={{title: "Focus view"}}
                    />
                ) : null}
                {isSkeleton ? (
                    <>
                        <div className="h-[70px] w-full m-3"></div>
                        <div className="h-[24.4px] w-full" />
                    </>
                ) : messageNodes ? (
                    <Expandable
                        className="[&_.agenta-shared-editor]:hover:!border-transparent"
                        expandKey={scenarioId}
                        buttonProps={{
                            className: evalType === "auto" ? "!right-7" : "top-0",
                        }}
                    >
                        <div className="flex flex-col gap-2 w-full">{messageNodes}</div>
                    </Expandable>
                ) : (
                    <Expandable
                        className="[&_.agenta-shared-editor]:hover:!border-transparent [&_.agenta-shared-editor]:!p-0"
                        expandKey={scenarioId}
                        buttonProps={{
                            className: evalType === "auto" ? "!right-7" : "top-0",
                        }}
                    >
                        <div className="w-full h-max">
                            {value ? (
                                <SharedEditor
                                    key={trace?.id || "no-response-cell"}
                                    handleChange={() => {}}
                                    initialValue={(() => {
                                        if (typeof value === "string") {
                                            try {
                                                const parsed = JSON5.parse(value)
                                                return JSON.stringify(parsed, null, 2)
                                            } catch {
                                                return value
                                            }
                                        }
                                        if (value && typeof value === "object") {
                                            try {
                                                return JSON.stringify(value, null, 2)
                                            } catch {
                                                return String(value)
                                            }
                                        }
                                        return String(value)
                                    })()}
                                    editorProps={{
                                        codeOnly: (() => {
                                            if (typeof value === "string") {
                                                try {
                                                    const parsed = JSON5.parse(value)
                                                    return Boolean(
                                                        parsed && typeof parsed === "object",
                                                    )
                                                } catch {
                                                    return false
                                                }
                                            }
                                            return !!value && typeof value !== "string"
                                        })(),
                                    }}
                                    editorType="borderless"
                                    disabled
                                    editorClassName="!text-xs"
                                    error={hasError}
                                />
                            ) : null}
                        </div>
                    </Expandable>
                )}
                {trace ? (
                    <div className="flex gap-2">
                        <GenerationResultUtils
                            showStatus={false}
                            result={{
                                response: {
                                    tree: {
                                        nodes: [trace],
                                    },
                                },
                            }}
                        />
                        <StatusCell scenarioId={scenarioId} result={record?.result} runId={runId} />
                    </div>
                ) : (
                    <div className="h-[24.4px] w-full" />
                )}
            </CellWrapper>
        )
    },
)

export const SkeletonCell = () => {
    return (
        <CellWrapper className="min-h-[32px] [&_*]:!min-w-full [&_*]:!w-full [&_*]:!max-w-full justify-center">
            <Skeleton.Input
                active
                style={{
                    minHeight: 24,
                    margin: 0,
                    padding: 0,
                }}
            />
        </CellWrapper>
    )
}
