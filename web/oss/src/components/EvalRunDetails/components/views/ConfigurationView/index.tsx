import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {CSSProperties, KeyboardEvent, ReactNode, UIEvent} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {compareRunIdsAtom, getComparisonColor} from "../../../atoms/compare"
import {
    runDisplayNameAtomFamily,
    runStatusAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
} from "../../../atoms/runDerived"
import {evaluationRunQueryAtomFamily} from "../../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../atoms/table/evaluators"
import {evaluationVariantConfigAtomFamily} from "../../../atoms/variantConfig"
import EvaluationRunTag from "../../EvaluationRunTag"

import EvaluatorSection from "./components/EvaluatorSection"
import GeneralSection from "./components/GeneralSection"
import InvocationSection from "./components/InvocationSection"
import {SectionCard, SectionSkeleton} from "./components/SectionPrimitives"
import TestsetSection from "./components/TestsetSection"

const {Text} = Typography

interface ConfigurationViewProps {
    runId: string
}

interface ConfigurationRunSummary {
    runId: string
    compareIndex: number
    isBaseRun: boolean
    accentColor: string
    runName: string
    runStatus: string | null
    runSlug: string | null
    generalSubtitle?: string
    testsetSubtitle?: string
    invocationSubtitle?: string
    evaluatorSubtitle?: string
    hasTestsets: boolean
    hasInvocation: boolean
    hasEvaluatorSection: boolean
    isLoading: boolean
}

const resolveLabel = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value !== "string") continue
        const trimmed = value.trim()
        if (trimmed) return trimmed
    }
    return undefined
}

const configurationRunSummaryAtomFamily = atomFamily(
    ({runId, compareIndex}: {runId: string; compareIndex: number}) =>
        atom((get) => {
            const runQuery = get(evaluationRunQueryAtomFamily(runId))
            const runData = runQuery.data?.camelRun ?? runQuery.data?.rawRun ?? null
            const runMeta = (runData?.meta ?? {}) as Record<string, unknown>

            const accentColor = getComparisonColor(compareIndex)
            const isBaseRun = compareIndex === 0

            const runName = get(runDisplayNameAtomFamily(runId)) ?? "—"
            const runStatus = get(runStatusAtomFamily(runId)) ?? null
            const runSlug =
                typeof runData?.slug === "string"
                    ? runData.slug
                    : typeof runMeta?.slug === "string"
                      ? (runMeta.slug as string)
                      : null

            const invocationRefs = get(runInvocationRefsAtomFamily(runId))
            const rawInvocationRefs = invocationRefs.rawRefs ?? {}
            const testsetIds = get(runTestsetIdsAtomFamily(runId)) ?? []
            const testsetCount = testsetIds.length

            const variantConfigQuery = get(evaluationVariantConfigAtomFamily(runId))
            const variantConfig = variantConfigQuery.data

            const applicationRef =
                rawInvocationRefs.application ?? rawInvocationRefs.application_ref ?? {}
            const applicationRevisionRef =
                rawInvocationRefs.applicationRevision ??
                rawInvocationRefs.application_revision ??
                {}
            const applicationVariantRef =
                rawInvocationRefs.applicationVariant ?? rawInvocationRefs.application_variant ?? {}

            const variantHeaderLabel = (() => {
                const variantRef =
                    (variantConfig as any)?.variant_ref ??
                    (variantConfig as any)?.variantRef ??
                    applicationVariantRef ??
                    {}
                return (
                    resolveLabel(
                        variantRef?.name,
                        applicationVariantRef?.name,
                        applicationVariantRef?.variant_name,
                        variantRef?.slug,
                        applicationVariantRef?.slug,
                        applicationRevisionRef?.slug,
                    ) ?? undefined
                )
            })()

            const applicationHeaderLabel = (() => {
                const variantApplicationRef =
                    (variantConfig as any)?.application_ref ??
                    (variantConfig as any)?.applicationRef ??
                    applicationRef ??
                    {}
                return (
                    resolveLabel(
                        variantApplicationRef?.name,
                        applicationRef?.name,
                        applicationRef?.app_name,
                        variantApplicationRef?.slug,
                        applicationRef?.slug,
                        applicationRef?.app_slug,
                    ) ?? undefined
                )
            })()

            const variantVersionLabel = (() => {
                const variantRef =
                    (variantConfig as any)?.variant_ref ??
                    (variantConfig as any)?.variantRef ??
                    applicationVariantRef ??
                    {}
                const rawVersion =
                    variantRef?.version ??
                    variantRef?.revision ??
                    applicationRevisionRef?.version ??
                    applicationRevisionRef?.revision ??
                    null
                if (rawVersion === null || rawVersion === undefined) return undefined
                const text = String(rawVersion).trim()
                return text ? `v${text}` : undefined
            })()

            const invocationHeaderSubtitle = (() => {
                const parts: string[] = []
                if (applicationHeaderLabel) parts.push(applicationHeaderLabel)
                const variantParts: string[] = []
                if (variantHeaderLabel) variantParts.push(variantHeaderLabel)
                if (variantVersionLabel) variantParts.push(variantVersionLabel)
                if (variantParts.length) parts.push(variantParts.join(" | "))
                return parts.join(" | ") || undefined
            })()

            const testsetHeaderSubtitle =
                testsetCount === 0
                    ? undefined
                    : testsetCount === 1
                      ? "1 linked set"
                      : `${testsetCount} linked sets`

            const evaluatorsQuery = get(evaluationEvaluatorsByRunQueryAtomFamily(runId))
            const evaluatorsLoading = evaluatorsQuery.isPending || evaluatorsQuery.isFetching
            const evaluatorError = evaluatorsQuery.error
            const evaluatorCount = Array.isArray(evaluatorsQuery.data)
                ? evaluatorsQuery.data.length
                : 0

            const evaluatorHeaderSubtitle = (() => {
                if (evaluatorsLoading) return "Loading..."
                if (evaluatorError) return "Error"
                if (evaluatorCount) {
                    return `${evaluatorCount} ${evaluatorCount === 1 ? "evaluator" : "evaluators"}`
                }
                return undefined
            })()

            const generalHeaderSubtitle = (() => {
                const label = resolveLabel(
                    runName !== "—" ? runName : undefined,
                    runSlug ?? undefined,
                )
                return label ?? undefined
            })()

            const isLoading = runQuery.isPending || runQuery.isFetching

            return {
                runId,
                compareIndex,
                isBaseRun,
                accentColor,
                runName,
                runStatus,
                runSlug,
                generalSubtitle: generalHeaderSubtitle,
                testsetSubtitle: testsetHeaderSubtitle,
                invocationSubtitle: invocationHeaderSubtitle,
                evaluatorSubtitle: evaluatorHeaderSubtitle,
                hasTestsets: testsetCount > 0,
                hasInvocation: Boolean(rawInvocationRefs && Object.keys(rawInvocationRefs).length),
                hasEvaluatorSection:
                    evaluatorsLoading || Boolean(evaluatorError) || evaluatorCount > 0,
                isLoading,
            } satisfies ConfigurationRunSummary
        }),
)

const useScrollSync = () => {
    const containersRef = useRef(new Map<string, HTMLDivElement>())
    const isSyncingRef = useRef(false)

    const register = useCallback((key: string, node: HTMLDivElement | null) => {
        const map = containersRef.current
        if (!node) {
            map.delete(key)
            return
        }
        map.set(key, node)
    }, [])

    const syncScroll = useCallback((key: string, scrollLeft: number) => {
        if (isSyncingRef.current) return
        const map = containersRef.current
        if (map.size <= 1) return
        isSyncingRef.current = true
        map.forEach((container, containerKey) => {
            if (!container || containerKey === key) return
            if (container.scrollLeft !== scrollLeft) {
                container.scrollLeft = scrollLeft
            }
        })
        requestAnimationFrame(() => {
            isSyncingRef.current = false
        })
    }, [])

    return {register, syncScroll}
}

interface SectionDefinition {
    key: string
    title: string
    alwaysVisible?: boolean
    hasData: (summary: ConfigurationRunSummary) => boolean
    getSubtitle?: (summary?: ConfigurationRunSummary) => string | undefined
    render: (runId: string, context?: {compareIndex: number}) => ReactNode
    fallbackMessage?: string
}

const sectionDefinitions: SectionDefinition[] = [
    {
        key: "general",
        title: "General",
        alwaysVisible: true,
        hasData: () => true,
        render: (runId, context) => <GeneralSection runId={runId} showActions showHeader={false} />,
    },
    {
        key: "testsets",
        title: "Testsets",
        hasData: (summary) => summary.hasTestsets,
        getSubtitle: (summary) => summary?.testsetSubtitle,
        render: (runId) => <TestsetSection runId={runId} />,
        fallbackMessage: "No linked test sets.",
    },
    {
        key: "invocation",
        title: "Application",
        hasData: (summary) => summary.hasInvocation,
        getSubtitle: (summary) => summary?.invocationSubtitle,
        render: (runId) => <InvocationSection runId={runId} />,
        fallbackMessage: "Application metadata unavailable.",
    },
    {
        key: "evaluators",
        title: "Evaluators",
        hasData: (summary) => summary.hasEvaluatorSection,
        getSubtitle: (summary) => summary?.evaluatorSubtitle,
        render: (runId) => <EvaluatorSection runId={runId} />,
        fallbackMessage: "No evaluator reference found for this run.",
    },
]

const ConfigurationSectionColumn = memo(
    ({
        runId,
        compareIndex,
        section,
    }: {
        runId: string
        compareIndex: number
        section: SectionDefinition
    }) => {
        const summaryAtom = useMemo(
            () => configurationRunSummaryAtomFamily({runId, compareIndex}),
            [runId, compareIndex],
        )
        const summary = useAtomValue(summaryAtom)

        const columnHasData = section.hasData(summary)

        let content: ReactNode = null
        if (summary.isLoading) {
            content = <SectionSkeleton />
        } else if (columnHasData || section.alwaysVisible) {
            content = section.render(runId, {compareIndex})
        } else if (section.fallbackMessage) {
            content = <Text className="text-neutral-500">{section.fallbackMessage}</Text>
        }

        const accentColor =
            !summary.isBaseRun && summary.accentColor !== "transparent"
                ? summary.accentColor
                : undefined

        if (section.key === "evaluators" || section.key === "testsets") {
            return (
                <div className="flex flex-col gap-6" style={{borderColor: accentColor}}>
                    {content}
                </div>
            )
        }

        if (section.key === "invocation") {
            return (
                <div className="flex flex-col gap-6" style={{borderColor: accentColor}}>
                    {content}
                </div>
            )
        }

        const card = (
            <SectionCard
                className="h-full"
                style={accentColor ? {borderColor: accentColor} : undefined}
            >
                {content}
            </SectionCard>
        )

        return card
    },
)

const EvaluationRunTagsRow = memo(
    ({
        runIds,
        registerScrollContainer,
        syncScroll,
    }: {
        runIds: string[]
        registerScrollContainer: (key: string, node: HTMLDivElement | null) => void
        syncScroll: (key: string, scrollLeft: number) => void
    }) => {
        const columnClass =
            runIds.length > 1 ? "auto-cols-[minmax(480px,1fr)]" : "auto-cols-[minmax(320px,1fr)]"
        const refKey = "section-evaluations"
        const handleRef = useCallback(
            (node: HTMLDivElement | null) => registerScrollContainer(refKey, node),
            [refKey, registerScrollContainer],
        )
        const handleScroll = useCallback(
            (event: UIEvent<HTMLDivElement>) => syncScroll(refKey, event.currentTarget.scrollLeft),
            [refKey, syncScroll],
        )

        return (
            <SectionCard className="!p-0 sticky top-0 z-20">
                <div
                    ref={handleRef}
                    onScroll={handleScroll}
                    className={`grid grid-flow-col ${columnClass} overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
                >
                    {runIds.map((runId, index) => (
                        <EvaluationRunTagItem
                            key={`evaluation-tag-${runId}`}
                            runId={runId}
                            index={index}
                        />
                    ))}
                </div>
            </SectionCard>
        )
    },
)

const EvaluationRunTagItem = memo(({runId, index}: {runId: string; index: number}) => {
    const runDisplayNameAtom = useMemo(() => runDisplayNameAtomFamily(runId), [runId])
    const runDisplayName = useAtomValue(runDisplayNameAtom)
    const summaryAtom = useMemo(
        () => configurationRunSummaryAtomFamily({runId, compareIndex: index}),
        [runId, index],
    )
    const summary = useAtomValue(summaryAtom)
    const label = resolveLabel(
        runDisplayName,
        summary.runName !== "—" ? summary.runName : undefined,
        summary.runSlug ?? undefined,
        summary.runId,
    )

    return (
        <div className="py-2 px-4 border-[0.5px] border-solid border-[#EAEFF5]">
            {summary.isLoading ? (
                <div className="h-6 w-full rounded-md bg-[#F2F4F7]" />
            ) : (
                <EvaluationRunTag
                    label={label ?? "Evaluation"}
                    compareIndex={index}
                    isBaseRun={summary.isBaseRun}
                />
            )}
        </div>
    )
})

const ConfigurationSectionRow = memo(
    ({
        section,
        runIds,
        runIdsSignature,
        registerScrollContainer,
        syncScroll,
    }: {
        section: SectionDefinition
        runIds: string[]
        runIdsSignature: string
        registerScrollContainer: (key: string, node: HTMLDivElement | null) => void
        syncScroll: (key: string, scrollLeft: number) => void
    }) => {
        const [collapsed, setCollapsed] = useState(false)
        useEffect(() => {
            setCollapsed(false)
        }, [runIdsSignature, section.key])

        const sectionVisibleAtom = useMemo(
            () =>
                atom((get) => {
                    if (section.alwaysVisible) {
                        return true
                    }
                    return runIds.some((runId, index) => {
                        const summary = get(
                            configurationRunSummaryAtomFamily({runId, compareIndex: index}),
                        )
                        return summary.isLoading || section.hasData(summary)
                    })
                }),
            [runIds, runIdsSignature, section],
        )
        const sectionVisible = useAtomValue(sectionVisibleAtom)

        const refKey = `section-${section.key}`
        const handleRef = useCallback(
            (node: HTMLDivElement | null) => registerScrollContainer(refKey, node),
            [refKey, registerScrollContainer],
        )
        const handleScroll = useCallback(
            (event: UIEvent<HTMLDivElement>) => syncScroll(refKey, event.currentTarget.scrollLeft),
            [refKey, syncScroll],
        )

        if (!sectionVisible) {
            return null
        }

        const columnClass =
            runIds.length > 1 ? "auto-cols-[minmax(480px,1fr)]" : "auto-cols-[minmax(320px,1fr)]"
        const grid = (
            <div
                ref={handleRef}
                onScroll={handleScroll}
                className={`grid grid-flow-col ${columnClass} overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
            >
                {runIds.map((runId, index) => (
                    <ConfigurationSectionColumn
                        key={`${section.key}-${runId}`}
                        runId={runId}
                        compareIndex={index}
                        section={section}
                    />
                ))}
            </div>
        )

        return (
            <div className="flex flex-col">
                <div
                    className={clsx(
                        "flex items-center justify-between",
                        "py-1 px-3 h-10",
                        "sticky top-0",
                        "bg-zinc-1 z-10",
                        "cursor-pointer",
                    )}
                    style={{
                        top: "40px",
                        borderBottom: "1px solid #EAEFF5",
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={() => setCollapsed((value) => !value)}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setCollapsed((value) => !value)
                        }
                    }}
                >
                    <Text className="text-sm font-semibold text-[#344054]">{section.title}</Text>

                    <Button
                        type="link"
                        size="small"
                        icon={<DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />}
                        onClick={(event) => {
                            event.stopPropagation()
                            setCollapsed((value) => !value)
                        }}
                    />
                </div>
                {!collapsed ? grid : null}
            </div>
        )
    },
)

const ConfigurationLayout = memo(({runIds}: {runIds: string[]}) => {
    const runIdsSignature = useMemo(() => runIds.join("|"), [runIds])
    const {register, syncScroll} = useScrollSync()

    return (
        <div
            className="flex flex-col pb-6"
            style={{"--config-header-offset": "40px"} as CSSProperties}
        >
            <EvaluationRunTagsRow
                runIds={runIds}
                registerScrollContainer={register}
                syncScroll={syncScroll}
            />
            {sectionDefinitions.map((section) => (
                <ConfigurationSectionRow
                    key={section.key}
                    section={section}
                    runIds={runIds}
                    runIdsSignature={runIdsSignature}
                    registerScrollContainer={register}
                    syncScroll={syncScroll}
                />
            ))}
        </div>
    )
})

const ConfigurationView = ({runId}: ConfigurationViewProps) => {
    const compareRunIds = useAtomValue(compareRunIdsAtom)

    const runIds = useMemo(() => {
        const unique = new Set<string>()
        const order: string[] = []
        const push = (id?: string | null) => {
            if (!id) return
            if (unique.has(id)) return
            unique.add(id)
            order.push(id)
        }
        push(runId)
        compareRunIds.forEach((id) => push(id))
        return order
    }, [runId, compareRunIds])

    if (!runIds.length) {
        return null
    }

    return (
        <div className="flex h-full min-h-0 flex-col px-2 bg-zinc-1 overflow-y-auto">
            <ConfigurationLayout runIds={runIds} />
        </div>
    )
}

export default memo(ConfigurationView)
