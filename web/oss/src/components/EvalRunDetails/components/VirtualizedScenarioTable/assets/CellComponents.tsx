import {forwardRef, HTMLProps, memo, useCallback, useMemo, useState} from "react"

import {ArrowsIn, ArrowsOut} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily, loadable, selectAtom} from "jotai/utils"
import dynamic from "next/dynamic"

import TooltipButton from "@/oss/components/Playground/assets/EnhancedButton"
import useResizeObserver from "@/oss/hooks/useResizeObserver"
import {resolvePath} from "@/oss/lib/helpers/traceUtils"
import {
    loadableScenarioStepFamily,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"

import {renderChatMessages} from "../../common/renderChatMessages"

const SharedEditor = dynamic(() => import("@/oss/components/Playground/Components/SharedEditor"), {
    ssr: false,
    loading: () => <div className="w-full min-h-[70px]" />,
})
const GenerationResultUtils = dynamic(
    () =>
        import(
            "../../../../Playground/Components/PlaygroundGenerations/assets/GenerationResultUtils"
        ),
    {ssr: false, loading: (props) => <div className="h-[24.4px] w-full" />},
)

// Global jotai store that keeps the expanded/collapsed state for each individual cell.
// The key must be STABLE between mounts (e.g. scenarioId + stepKey + path) so that when
// a row is unmounted/remounted by react-window, the UI preserves its previous state.
export const expandedCellStateAtom = atom<Record<string, boolean>>({})
interface ExpandableProps {
    /**
     * Stable identifier for the cell. If omitted, the component falls back to local state.
     */
    expandKey?: string
    className?: string
    children: React.ReactNode
}

export const Expandable = forwardRef(
    ({children, className, expandKey, ...props}: ExpandableProps, forwardedRef) => {
        // Local overflow calculation is still component-local because it depends on DOM size.
        const [hasOverflow, setHasOverflow] = useState(false)

        // Global or local expanded state depending on expandKey presence
        const [expandedMap, setExpandedMap] = useAtom(expandedCellStateAtom)
        const expandedLocalState = useState(false)
        const expanded = expandKey ? (expandedMap[expandKey] ?? false) : expandedLocalState[0]
        const setExpanded = useCallback(
            (value: boolean | ((prev: boolean) => boolean)) => {
                if (expandKey) {
                    setExpandedMap((prev) => {
                        const nextVal =
                            typeof value === "function" ? value(prev[expandKey] ?? false) : value
                        return {...prev, [expandKey]: nextVal}
                    })
                } else {
                    // @ts-expect-error – tuple type
                    expandedLocalState[1](value)
                }
            },
            [expandKey, setExpandedMap, expandedLocalState],
        )

        const ref = useResizeObserver(
            useCallback((rect, element) => {
                setHasOverflow((prev) => {
                    const next =
                        element.scrollHeight > rect.height ||
                        (element.children && element.children?.[0]?.offsetHeight > rect.height)
                    if (next !== prev) {
                        return next
                    }

                    return prev
                })
            }, []),
        )

        const toggleExpanded = useCallback(
            (e: React.MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                setExpanded((prev: boolean) => !prev)
            },
            [setExpanded],
        )

        return (
            <div
                className="table-cell-expandable relative w-full h-full"
                ref={forwardedRef}
                {...props}
            >
                {/* Content container */}
                <div
                    ref={ref}
                    className={clsx(
                        className,
                        "cell-expand-container",
                        "relative w-full mb-2 transition-all duration-300 ease-linear overflow-hidden",
                        {
                            "h-[76px]": !expanded,
                            "h-fit": expanded,
                        },
                    )}
                >
                    {children}
                </div>
                {/* Gradient overlay to hint overflow */}
                {/* {hasOverflow && !expanded && (
                    <div className="absolute bottom-0 left-0 right-0 w-full h-6 z-[1] bg-gradient-to-t from-gray-200 to-transparent" />
                )} */}
                {(hasOverflow || expanded) && (
                    <TooltipButton
                        className="absolute bottom-0 right-0 z-[2]"
                        onClick={toggleExpanded}
                        size="small"
                        icon={
                            expanded ? (
                                <ArrowsIn size={14} className="mt-[1.5px] ml-[0.5px]" />
                            ) : (
                                <ArrowsOut size={14} className="mt-[1.5px] ml-[0.5px]" />
                            )
                        }
                        tooltipProps={{title: expanded ? "Collapse" : "Expand"}}
                    />
                )}
            </div>
        )
    },
)

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
    ({scenarioId, inputKey, stepKey}: {scenarioId: string; inputKey: string; stepKey?: string}) => {
        const stepLoadable = useAtomValue(loadable(scenarioStepFamily(scenarioId)))
        if (stepLoadable.state !== "hasData" || !stepLoadable.data)
            return (
                <CellWrapper>
                    <span className="text-gray-400">—</span>
                </CellWrapper>
            )
        const enrichedArr = stepLoadable.data?.inputSteps ?? []
        let targetStep = stepKey ? enrichedArr.find((s) => s.key === stepKey) : undefined
        if (!targetStep) targetStep = stepLoadable.data?.inputStep ?? enrichedArr[0]
        let val: any
        if (targetStep && (targetStep as any).inputs) {
            const inputs = (targetStep as any).inputs ?? {}
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
            reactNodes = renderChatMessages(`${scenarioId}-${inputKey}`, val as string)
        }

        return (
            <CellWrapper>
                <Expandable
                    expandKey={`${scenarioId}-${inputKey}`}
                    className={clsx([
                        "[&_.agenta-shared-editor]:hover:!border-transparent",
                        {
                            "[&_.agenta-shared-editor]:p-0": !reactNodes,
                        },
                    ])}
                >
                    {reactNodes ? (
                        <div className="flex flex-col gap-2 w-full">{reactNodes}</div>
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
    }: {
        isSkeleton: boolean
        scenarioId: string
        stepKey: string
        path: string
    }) => {
        const {trace, value, messageNodes} = useInvocationResult({scenarioId, stepKey})

        return (
            <CellWrapper className="flex flex-col !items-start justify-between gap-2 text-wrap">
                {isSkeleton ? (
                    <>
                        <div className="h-[70px] w-full m-3"></div>
                        <div className="h-[24.4px] w-full" />
                    </>
                ) : messageNodes ? (
                    <Expandable
                        className="[&_.agenta-shared-editor]:hover:!border-transparent"
                        expandKey={`${scenarioId}-${stepKey}-${path}`}
                    >
                        <div className="flex flex-col gap-2 w-full">{messageNodes}</div>
                    </Expandable>
                ) : (
                    <Expandable
                        className="[&_.agenta-shared-editor]:hover:!border-transparent"
                        expandKey={`${scenarioId}-${stepKey}-${path}`}
                    >
                        <div className="w-full h-max">
                            <SharedEditor
                                handleChange={() => {}}
                                initialValue={value}
                                editorProps={{
                                    codeOnly: !!value && typeof value !== "string",
                                }}
                                editorType="borderless"
                                disabled
                                editorClassName="!text-xs"
                                error={!!trace?.exception}
                            />
                        </div>
                    </Expandable>
                )}
                {trace ? (
                    <GenerationResultUtils
                        result={{
                            response: {
                                tree: {
                                    nodes: [trace],
                                },
                            },
                        }}
                    />
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
