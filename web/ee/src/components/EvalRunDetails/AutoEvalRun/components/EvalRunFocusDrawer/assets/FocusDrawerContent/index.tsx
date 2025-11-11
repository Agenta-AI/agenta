import {useCallback, useEffect, useMemo, useState} from "react"

import SimpleSharedEditor from "@agenta/oss/src/components/EditorViews/SimpleSharedEditor"
import VirtualizedSharedEditors from "@agenta/oss/src/components/EditorViews/VirtualizedSharedEditors"
import {Collapse, CollapseProps, Tag, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/assets/renderChatMessages"
import {STATUS_COLOR} from "@/oss/components/EvalRunDetails/components/EvalRunScenarioStatusTag/assets"
import {titleCase} from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/assets/flatDataSourceBuilder"
import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {getStatusLabel} from "@/oss/lib/constants/statusLabels"
import {
    evalAtomStore,
    evaluationRunStateAtom,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {metricDataFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"
import {EvaluationStatus} from "@/oss/lib/Types"

import EvalNameTag from "../../../../assets/EvalNameTag"

const GenerationResultUtils = dynamic(
    () =>
        import(
            "@/oss/components/Playground/Components/PlaygroundGenerations/assets/GenerationResultUtils"
        ),
    {ssr: false},
)

const failureRunTypes = [EvaluationStatus.FAILED, EvaluationStatus.FAILURE, EvaluationStatus.ERROR]

const FocusDrawerContent = () => {
    const router = useRouter()
    const [windowHight, setWindowHight] = useState(0)
    const [activeKeys, setActiveKeys] = useState<(string | number)[]>(["input", "output"])

    // atoms
    const scenarioId = useAtomValue(focusScenarioAtom)
    const evaluationRunData = useAtomValue(evaluationRunStateAtom)
    const stepLoadable = useAtomValue(loadable(scenarioStepFamily(scenarioId as string)))

    const enricedRun = evaluationRunData?.enrichedRun
    const invocationStep = useMemo(() => stepLoadable.data?.invocationSteps?.[0], [stepLoadable])
    const {
        trace,
        value: outputValue,
        messageNodes,
        hasError,
    } = useInvocationResult({
        scenarioId: invocationStep?.scenarioId,
        stepKey: invocationStep?.key,
        editorType: "simple",
        viewType: "single",
    })

    const entries = useMemo(() => {
        const inputSteps = stepLoadable.data?.inputSteps

        if (stepLoadable.state !== "hasData" || !inputSteps) return []
        const out: {k: string; v: unknown}[] = []
        inputSteps.forEach((inputCol) => {
            let _inputs = {}
            try {
                const {testcase_dedup_id, ...rest} = inputCol.testcase.data
                _inputs = {...(inputCol as any).inputs, ...rest}
            } catch (e) {
                _inputs = inputCol?.inputs ?? {}
            }
            Object.entries(_inputs || {})?.forEach(([k, v]) => out.push({k: titleCase(k), v}))
        })
        return out
    }, [stepLoadable])

    const evaluatorMetrics = useMemo(() => {
        const evaluators = enricedRun?.evaluators
        return evaluators?.map((evaluator) => ({
            name: evaluator.name,
            metrics: evaluator.metrics,
            slug: evaluator.slug,
        }))
    }, [enricedRun])

    const openAndScrollTo = useCallback((key: string) => {
        setActiveKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))

        // wait for Collapse to render/expand, then scroll
        const tryScroll = (attempt = 0) => {
            const el = document.getElementById(`section-${key}`)
            // element is visible when offsetParent is not null (after expand)
            if (el && el.offsetParent !== null) {
                el.scrollIntoView({behavior: "smooth", block: "start", inline: "nearest"})
            } else if (attempt < 10) {
                requestAnimationFrame(() => tryScroll(attempt + 1))
            }
        }
        requestAnimationFrame(() => tryScroll())
    }, [])

    const handleCollapseChange = useCallback((keys: string[]) => {
        // Check if any dropdown is open by looking for the dropdown menu with the 'open' class
        // This is for improving micro interactions
        const openSelects = document.querySelectorAll(
            ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
        )
        const openDropdowns = document.querySelectorAll(".ant-dropdown:not(.ant-dropdown-hidden)")
        if (openSelects.length > 0 || openDropdowns.length > 0) {
            return
        }
        setActiveKeys(keys)
    }, [])

    // TODO remove this from here and create a function or something to also use in somewhere else
    const getErrorStep = useCallback(
        (metricKey: string, scenarioId: string) => {
            if (stepLoadable.state === "loading") return null
            const [evalSlug, key] = metricKey.split(".")
            if (!key) return null // if does not have key that means it's not an evaluator metric
            const _step = stepLoadable.data?.steps?.find((s) => s.key === evalSlug)

            if (!_step) {
                const invocationStep = stepLoadable.data?.invocationSteps?.find(
                    (s) => s.scenarioId === scenarioId,
                )

                if (failureRunTypes.includes(invocationStep?.status)) {
                    return {
                        status: invocationStep?.status,
                        error: invocationStep?.error?.stacktrace || invocationStep?.error?.message,
                    }
                }
                return null
            }

            if (failureRunTypes.includes(_step?.status)) {
                return {
                    status: _step?.status,
                    error: _step?.error?.stacktrace || _step?.error?.message,
                }
            }

            return null
        },
        [stepLoadable],
    )

    useEffect(() => {
        setWindowHight(window.innerHeight)
    }, [stepLoadable])

    useEffect(() => {
        const evaluatorSlug = enricedRun?.evaluators?.map((evaluator) => evaluator.slug)
        if (evaluatorSlug?.length) {
            setActiveKeys((prev) => [...prev, ...evaluatorSlug])
        }
    }, [enricedRun])

    useEffect(() => {
        const hash = router.asPath.split("#")[1]?.trim()
        if (!hash) return
        openAndScrollTo(hash)
    }, [router.asPath, openAndScrollTo])

    const items: CollapseProps["items"] = useMemo(() => {
        if (stepLoadable.state !== "hasData" || !scenarioId) return []

        return [
            {
                key: "input",
                label: (
                    <span id="section-input" className="font-medium">
                        Inputs
                    </span>
                ),
                children: (
                    <div className="flex flex-col gap-2 min-h-0 h-fit scroll-mt-2">
                        <VirtualizedSharedEditors
                            entries={entries}
                            overscanCount={1}
                            estimatedRowHeight={120}
                            className="h-full"
                            listHeight={windowHight - 120}
                            renderRow={(entry) => {
                                // Detect chat-shaped JSON like in CellComponents.tsx
                                let isChat = false
                                if (typeof entry.v === "string") {
                                    try {
                                        const parsed = JSON.parse(entry.v)
                                        isChat =
                                            Array.isArray(parsed) &&
                                            parsed.every((m: any) => "role" in m && "content" in m)
                                    } catch {
                                        /* ignore */
                                    }
                                }

                                if (isChat) {
                                    const nodes = renderChatMessages({
                                        keyPrefix: `${scenarioId}-${entry.k}`,
                                        rawJson: entry.v as string,
                                        view: "single",
                                        editorType: "simple",
                                    })
                                    return (
                                        <div
                                            key={`${entry.k}-${scenarioId}`}
                                            className="flex flex-col gap-2 w-full"
                                        >
                                            {nodes}
                                        </div>
                                    )
                                }

                                return (
                                    <SimpleSharedEditor
                                        key={`${entry.k}-${scenarioId}`}
                                        handleChange={() => {}}
                                        headerName={entry.k}
                                        initialValue={String(entry.v)}
                                        editorType="borderless"
                                        state="readOnly"
                                        placeholder="N/A"
                                        disabled
                                        readOnly
                                        editorClassName="!text-xs"
                                        className="!w-[97.5%]"
                                        editorProps={{enableResize: true}}
                                    />
                                )
                            }}
                        />
                    </div>
                ),
            },
            {
                key: "trace",
                className: "!rounded-none !px-0 [&_.ant-collapse-header]:!px-0",
                collapsible: "disabled",
                disabled: true,
                showArrow: false,
                label: (
                    <div
                        id="section-output"
                        className="h-[40px] px-3 flex items-center justify-between border-0 border-b border-t border-solid border-gray-200"
                    >
                        <EvalNameTag name={enricedRun?.name} color="blue" />
                        {trace ? (
                            <GenerationResultUtils
                                className="flex-row-reverse"
                                result={{response: {tree: {nodes: [trace]}}}}
                            />
                        ) : (
                            <div className="h-[24.4px] w-full" />
                        )}
                    </div>
                ),
            },
            {
                key: "output",
                label: <span className="font-medium">Outputs</span>,
                children: (
                    <div className="min-h-0 scroll-mt-2">
                        {messageNodes ? (
                            messageNodes
                        ) : (
                            <SimpleSharedEditor
                                key={`output-${scenarioId}`}
                                handleChange={() => {}}
                                initialValue={
                                    !!outputValue && typeof outputValue !== "string"
                                        ? JSON.stringify(outputValue)
                                        : outputValue
                                }
                                headerName="Output"
                                editorType="borderless"
                                state="readOnly"
                                disabled
                                readOnly
                                editorClassName="!text-xs"
                                error={hasError}
                                placeholder="N/A"
                                className="!w-[97.5%]"
                            />
                        )}
                    </div>
                ),
            },
            ...(evaluatorMetrics || []).map((evaluator, idx) => {
                const metrics = evaluator.metrics
                const isFirst = idx === 0
                const prevSlug = evaluatorMetrics?.[idx - 1]?.slug
                const isPrevOpen = !!(prevSlug && activeKeys.includes(prevSlug))

                if (!evaluator) return null
                return {
                    key: evaluator.slug,
                    label: (
                        <span id={idx === 0 ? "evaluator" : ""} className="font-medium">
                            {evaluator.name}
                        </span>
                    ),
                    className: clsx(
                        "[&_.ant-collapse-header]:border-0 [&_.ant-collapse-header]:border-solid [&_.ant-collapse-header]:border-gray-200",
                        "[&_.ant-collapse-header]:!rounded-none [&_.ant-collapse-header]:!py-[9px]",
                        "[&_.ant-collapse-header]:border-b",
                        {
                            // Top border for first item or when previous evaluator is open
                            "[&_.ant-collapse-header]:border-t": isFirst || isPrevOpen,
                        },
                    ),
                    children: Object.keys(metrics || {})?.map((metricKey) => {
                        const metricData = evalAtomStore().get(
                            metricDataFamily({
                                scenarioId: scenarioId!,
                                metricKey: `${evaluator.slug}.${metricKey}`,
                            }),
                        )

                        const errorStep =
                            !metricData?.distInfo || hasError
                                ? getErrorStep(`${evaluator.slug}.${metricKey}`, scenarioId)
                                : null

                        let value
                        if (
                            metricData?.value?.frequency &&
                            metricData?.value?.frequency?.length > 0
                        ) {
                            const mostFrequent = metricData?.value?.frequency?.reduce(
                                (max, current) => (current.count > max.count ? current : max),
                            ).value
                            value = String(mostFrequent)
                        } else {
                            const prim = Object.values(metricData?.value || {}).find(
                                (v) => typeof v === "number" || typeof v === "string",
                            )
                            value = prim !== undefined ? prim : JSON.stringify(metricData?.value)
                        }

                        const formatted = formatMetricValue(metricKey, value || "")

                        return (
                            <div
                                key={metricKey}
                                id={`section-${evaluator.slug}`}
                                className="flex flex-col items-start gap-1 mb-3"
                            >
                                <span>{metricKey}</span>
                                {errorStep?.status || errorStep?.error ? (
                                    <Tooltip
                                        title={errorStep?.error}
                                        classNames={{
                                            body: "max-w-[200px] max-h-[300px] overflow-y-auto",
                                        }}
                                    >
                                        <Tag
                                            color={STATUS_COLOR[errorStep?.status]}
                                            bordered={false}
                                        >
                                            {getStatusLabel(errorStep?.status)}
                                        </Tag>
                                    </Tooltip>
                                ) : (
                                    <Tag
                                        className="bg-[#0517290F] hover:bg-[#05172916]"
                                        bordered={false}
                                    >
                                        {typeof formatted === "object" ||
                                        formatted === undefined ||
                                        formatted === null
                                            ? "N/A"
                                            : String(formatted)}
                                    </Tag>
                                )}
                            </div>
                        )
                    }),
                }
            }),
        ]
    }, [
        entries,
        stepLoadable.state,
        windowHight,
        outputValue,
        trace,
        enricedRun?.name,
        scenarioId,
        activeKeys,
        messageNodes,
        hasError,
    ])

    if (!scenarioId || stepLoadable.state !== "hasData" || !enricedRun) return null

    return (
        <section className="h-full flex flex-col gap-2 scroll-smooth pb-2">
            <Collapse
                ghost
                activeKey={activeKeys}
                onChange={handleCollapseChange}
                expandIconPosition="end"
                items={items}
                className="h-full !rounded-none"
            />
        </section>
    )
}

export default FocusDrawerContent
