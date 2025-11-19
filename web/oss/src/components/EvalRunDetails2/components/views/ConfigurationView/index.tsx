import {memo, useCallback, useMemo, useRef, useState} from "react"
import type {ReactNode, UIEvent} from "react"

import {Button, Card, Skeleton, Space, Typography} from "antd"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {compareRunIdsAtom, getComparisonColor} from "../../../atoms/compare"
import {
    evaluationQueryReferenceAtomFamily,
    evaluationQueryRevisionAtomFamily,
} from "../../../atoms/query"
import {
    runDisplayNameAtomFamily,
    runStatusAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
} from "../../../atoms/runDerived"
import {evaluationRunQueryAtomFamily} from "../../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../atoms/table/evaluators"
import {evaluationVariantConfigAtomFamily} from "../../../atoms/variantConfig"
import {useRunMetricData, type RunDescriptor} from "../OverviewView/hooks/useRunMetricData"

import EvaluatorSection from "./components/EvaluatorSection"
import GeneralSection from "./components/GeneralSection"
import InvocationSection from "./components/InvocationSection"
import QuerySection from "./components/QuerySection"
import TestsetSection from "./components/TestsetSection"
import {hasQueryReference} from "./utils"

const {Text, Title} = Typography

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
    querySubtitle?: string
    evaluatorSubtitle?: string
    hasTestsets: boolean
    hasInvocation: boolean
    hasQuery: boolean
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

            const queryReference = get(evaluationQueryReferenceAtomFamily(runId)) ?? {}
            const queryRevisionQuery = get(evaluationQueryRevisionAtomFamily(runId))
            const queryRevision = queryRevisionQuery.data?.revision ?? null
            const queryRevisionVersionLabel =
                queryRevision?.version ?? (queryReference as any).queryRevisionVersion ?? undefined
            const queryHasReference = hasQueryReference(queryReference)

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

            const queryHeaderSubtitle = (() => {
                const base = resolveLabel(
                    (queryReference as any).querySlug,
                    (queryReference as any).queryId,
                    queryRevision?.slug,
                    queryRevision?.id,
                )
                const parts: string[] = []
                if (base) parts.push(base)
                if (
                    queryRevisionVersionLabel !== undefined &&
                    queryRevisionVersionLabel !== null &&
                    String(queryRevisionVersionLabel).trim() !== ""
                ) {
                    parts.push(`rev ${queryRevisionVersionLabel}`)
                }
                return parts.join(" | ") || undefined
            })()

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
                querySubtitle: queryHeaderSubtitle,
                evaluatorSubtitle: evaluatorHeaderSubtitle,
                hasTestsets: testsetCount > 0,
                hasInvocation: Boolean(rawInvocationRefs && Object.keys(rawInvocationRefs).length),
                hasQuery: queryHasReference,
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

const RunSummaryCard = memo(
    ({
        runId,
        compareIndex,
        runName,
        runStatus,
    }: {
        runId: string
        compareIndex: number
        runName?: string
        runStatus?: string | null
    }) => {
        const summaryAtom = useMemo(
            () => configurationRunSummaryAtomFamily({runId, compareIndex}),
            [runId, compareIndex],
        )
        const summary = useAtomValue(summaryAtom)

        const _displayName = runName ?? summary.runName
        const _displayStatus = runStatus ?? summary.runStatus
        const _showSkeleton =
            summary.isLoading &&
            (!_displayName || (typeof _displayName === "string" && _displayName === "—"))

        return (
            <div className="flex min-h-[140px] flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                        {/* {showSkeleton ? (
                            <Skeleton.Input active size="small" style={{width: 120}} />
                        ) : (
                            <Text className="truncate text-base font-semibold text-neutral-900">
                                {displayName ?? "—"}
                            </Text>
                        )} */}

                        {/* {summary.generalSubtitle ? (
                            <Text className="truncate text-xs text-neutral-500">
                                {summary.generalSubtitle}
                            </Text>
                        ) : null} */}
                    </div>
                    {/* <Space size={4} wrap>
                        <Tag color={compareIndex === 0 ? "geekblue" : "purple"}>
                            {compareIndex === 0 ? "Base run" : `Comparison ${compareIndex}`}
                        </Tag>
                        {displayStatus ? <Tag color="blue">{displayStatus}</Tag> : null}
                    </Space> */}
                </div>
                {/* <ContextChipList runId={runId} /> */}
            </div>
        )
    },
)

const _RunSummaryRow = memo(
    ({
        runIds,
        runDescriptors,
        registerScrollContainer,
        syncScroll,
    }: {
        runIds: string[]
        runDescriptors: RunDescriptor[]
        registerScrollContainer: (key: string, node: HTMLDivElement | null) => void
        syncScroll: (key: string, scrollLeft: number) => void
    }) => {
        const handleRef = useCallback(
            (node: HTMLDivElement | null) => registerScrollContainer("summary", node),
            [registerScrollContainer],
        )
        const handleScroll = useCallback(
            (event: UIEvent<HTMLDivElement>) =>
                syncScroll("summary", event.currentTarget.scrollLeft),
            [syncScroll],
        )

        return (
            <Card>
                <Title level={5} className="!mb-3">
                    Evaluation context
                </Title>
                <div
                    ref={handleRef}
                    onScroll={handleScroll}
                    className="grid grid-flow-col auto-cols-[minmax(320px,1fr)] gap-4 overflow-x-auto pb-2"
                >
                    {runIds.map((runId, index) => {
                        const descriptor = runDescriptors[index]
                        return (
                            <RunSummaryCard
                                key={runId}
                                runId={runId}
                                compareIndex={index}
                                runName={descriptor?.displayName}
                                runStatus={descriptor?.status}
                            />
                        )
                    })}
                </div>
            </Card>
        )
    },
)

interface SectionDefinition {
    key: string
    title: string
    alwaysVisible?: boolean
    hasData: (summary: ConfigurationRunSummary) => boolean
    getSubtitle?: (summary?: ConfigurationRunSummary) => string | undefined
    render: (
        runId: string,
        registerActions?: (actions: {
            save: () => void
            reset: () => void
            disabled: boolean
            saving: boolean
        }) => void,
    ) => ReactNode
    fallbackMessage?: string
}

const sectionDefinitions: SectionDefinition[] = [
    {
        key: "general",
        title: "General",
        alwaysVisible: true,
        hasData: () => true,
        // getSubtitle: (summary) => null,
        // getSubtitle: (summary) => summary?.generalSubtitle,
        render: (runId, registerActions) => (
            <GeneralSection runId={runId} onRegisterActions={registerActions} />
        ),
    },
    {
        key: "testsets",
        title: "Test sets",
        hasData: (summary) => summary.hasTestsets,
        getSubtitle: (summary) => summary?.testsetSubtitle,
        render: (runId) => <TestsetSection runId={runId} />,
        fallbackMessage: "No linked test sets.",
    },
    {
        key: "invocation",
        title: "Invocation",
        hasData: (summary) => summary.hasInvocation,
        getSubtitle: (summary) => summary?.invocationSubtitle,
        render: (runId) => <InvocationSection runId={runId} />,
        fallbackMessage: "Invocation metadata unavailable.",
    },
    {
        key: "query",
        title: "Query configuration",
        hasData: (summary) => summary.hasQuery,
        getSubtitle: (summary) => summary?.querySubtitle,
        render: (runId) => <QuerySection runId={runId} />,
        fallbackMessage: "No query linked to this evaluation.",
    },
    {
        key: "evaluators",
        title: "Evaluators",
        hasData: (summary) => summary.hasEvaluatorSection,
        getSubtitle: (summary) => summary?.evaluatorSubtitle,
        render: (runId) => <EvaluatorSection runId={runId} />,
        fallbackMessage: "No evaluators configured.",
    },
]

const ConfigurationSectionColumn = memo(
    ({
        runId,
        compareIndex,
        section,
        runName,
        onRegisterHeaderActions,
    }: {
        runId: string
        compareIndex: number
        section: SectionDefinition
        runName?: string
        onRegisterHeaderActions?: (actions: {
            save: () => void
            reset: () => void
            disabled: boolean
            saving: boolean
        }) => void
    }) => {
        const summaryAtom = useMemo(
            () => configurationRunSummaryAtomFamily({runId, compareIndex}),
            [runId, compareIndex],
        )
        const summary = useAtomValue(summaryAtom)

        const columnHasData = section.hasData(summary)

        let content: ReactNode = null
        if (summary.isLoading) {
            content = <Skeleton active paragraph={{rows: 3}} />
        } else if (columnHasData || section.alwaysVisible) {
            // Only the base run column provides header actions for the section
            const register =
                section.key === "general" && compareIndex === 0
                    ? onRegisterHeaderActions
                    : undefined
            content = section.render(runId, register)
        } else if (section.fallbackMessage) {
            content = <Text className="text-sm text-neutral-500">{section.fallbackMessage}</Text>
        }

        const accentColor =
            !summary.isBaseRun && summary.accentColor !== "transparent"
                ? summary.accentColor
                : undefined

        return (
            <div
                className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white"
                style={accentColor ? {borderColor: accentColor} : undefined}
            >
                {/* <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
                    <div className="min-w-0">
                        <Text className="block truncate text-sm font-medium text-neutral-900">
                            {displayName}
                        </Text>
                        {subtitle ? (
                            <Text className="block truncate text-xs text-neutral-500">
                                {subtitle}
                            </Text>
                        ) : null}
                    </div>
                    <Tag color={compareIndex === 0 ? "geekblue" : "purple"}>
                        {compareIndex === 0 ? "Base" : `Comparison ${compareIndex}`}
                    </Tag>
                </div> */}
                <div className="flex-1 px-2 py-2">{content}</div>
            </div>
        )
    },
)

const ConfigurationSectionRow = memo(
    ({
        section,
        runIds,
        runIdsSignature,
        runDescriptors,
        registerScrollContainer,
        syncScroll,
    }: {
        section: SectionDefinition
        runIds: string[]
        runIdsSignature: string
        runDescriptors: RunDescriptor[]
        registerScrollContainer: (key: string, node: HTMLDivElement | null) => void
        syncScroll: (key: string, scrollLeft: number) => void
    }) => {
        const [headerActions, setHeaderActions] = useState<{
            save: () => void
            reset: () => void
            disabled: boolean
            saving: boolean
        } | null>(null)
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

        return (
            <Card>
                <div className="flex items-center justify-between !mb-3">
                    <Title level={5} className="!mb-0 !mt-0">
                        {section.title}
                    </Title>
                    {section.key === "general" && headerActions ? (
                        <Space size={8} wrap>
                            <Button
                                onClick={headerActions.reset}
                                disabled={headerActions.saving || headerActions.disabled}
                            >
                                Reset
                            </Button>
                            <Button
                                type="primary"
                                onClick={headerActions.save}
                                loading={headerActions.saving}
                                disabled={headerActions.disabled}
                            >
                                Save
                            </Button>
                        </Space>
                    ) : null}
                </div>
                <div
                    ref={handleRef}
                    onScroll={handleScroll}
                    className="grid grid-flow-col auto-cols-[minmax(320px,1fr)] gap-4 overflow-x-auto pb-2"
                >
                    {runIds.map((runId, index) => {
                        const descriptor = runDescriptors[index]
                        return (
                            <ConfigurationSectionColumn
                                key={`${section.key}-${runId}`}
                                runId={runId}
                                compareIndex={index}
                                section={section}
                                runName={descriptor?.displayName}
                                onRegisterHeaderActions={setHeaderActions}
                            />
                        )
                    })}
                </div>
            </Card>
        )
    },
)

const ConfigurationLayout = memo(({runIds}: {runIds: string[]}) => {
    const runIdsSignature = useMemo(() => runIds.join("|"), [runIds])
    const {register, syncScroll} = useScrollSync()
    const {runDescriptors} = useRunMetricData(runIds)

    return (
        <div className="flex flex-col gap-4 pb-6">
            {/* <RunSummaryRow
                runIds={runIds}
                runDescriptors={runDescriptors}
                registerScrollContainer={register}
                syncScroll={syncScroll}
            /> */}
            {sectionDefinitions.map((section) => (
                <ConfigurationSectionRow
                    key={section.key}
                    section={section}
                    runIds={runIds}
                    runIdsSignature={runIdsSignature}
                    runDescriptors={runDescriptors}
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
        <div className="flex h-full min-h-0 flex-col px-6 pt-2 bg-zinc-1">
            <div className="flex-1 overflow-y-auto">
                <ConfigurationLayout runIds={runIds} />
            </div>
        </div>
    )
}

export default memo(ConfigurationView)
