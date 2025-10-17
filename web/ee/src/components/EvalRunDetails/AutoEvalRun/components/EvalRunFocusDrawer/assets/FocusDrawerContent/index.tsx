import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import SimpleSharedEditor from "@agenta/oss/src/components/EditorViews/SimpleSharedEditor"
import VirtualizedSharedEditors from "@agenta/oss/src/components/EditorViews/VirtualizedSharedEditors"
import {Collapse, CollapseProps, Tag, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"
import {useRouter} from "next/router"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/assets/renderChatMessages"
import {STATUS_COLOR} from "@/oss/components/EvalRunDetails/components/EvalRunScenarioStatusTag/assets"
import {titleCase} from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/assets/flatDataSourceBuilder"
import {comparisonRunsStepsAtom} from "@/oss/components/EvalRunDetails/components/VirtualizedScenarioTable/hooks/useExpandableComparisonDataSource"
import {focusScenarioAtom} from "@/oss/components/EvalRunDetails/state/focusScenarioAtom"
import {urlStateAtom} from "@/oss/components/EvalRunDetails/state/urlState"
import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import {getStatusLabel} from "@/oss/lib/constants/statusLabels"
import {
    evalAtomStore,
    scenarioStepFamily,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {runScopedMetricDataFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"
import {EvaluationStatus} from "@/oss/lib/Types"
import {useAppState} from "@/oss/state/appState"

import FocusDrawerContentSkeleton from "../Skeletons/FocusDrawerContentSkeleton"

import RunOutput from "./assets/RunOutput"
import RunTraceHeader from "./assets/RunTraceHeader"

const failureRunTypes = [EvaluationStatus.FAILED, EvaluationStatus.FAILURE, EvaluationStatus.ERROR]
const EMPTY_COMPARISON_RUN_IDS: string[] = []

const FocusDrawerContent = () => {
    const router = useRouter()
    const appState = useAppState()

    const [windowHight, setWindowHight] = useState(0)
    const [activeKeys, setActiveKeys] = useState<(string | number)[]>([
        "input",
        "output",
        "evaluators",
    ])

    // atoms
    const focus = useAtomValue(focusScenarioAtom)
    const urlState = useAtomValue(urlStateAtom)
    const scenarioId = focus?.focusScenarioId as string
    const runId = focus?.focusRunId as string
    const rawCompareRunIds = Array.isArray(urlState?.compare) ? urlState.compare : []
    const compareRunIdsKey = rawCompareRunIds.join("|")
    const evaluationRunData = useAtomValue(evaluationRunStateFamily(runId!))
    const comparisonRunIds = useMemo(() => {
        if (!rawCompareRunIds.length) return EMPTY_COMPARISON_RUN_IDS
        return rawCompareRunIds.slice()
    }, [compareRunIdsKey])
    const rawBaseRunId = useMemo(() => {
        const routerValue = router.query?.evaluation_id
        if (Array.isArray(routerValue)) {
            const firstRouterId = routerValue[0]
            if (firstRouterId) return firstRouterId
        } else if (typeof routerValue === "string" && routerValue.length > 0) {
            return routerValue
        }

        const appStateValue = appState.query?.evaluation_id
        if (Array.isArray(appStateValue)) {
            return appStateValue[0] ?? null
        }

        return typeof appStateValue === "string" && appStateValue.length > 0 ? appStateValue : null
    }, [appState.query?.evaluation_id, router.query?.evaluation_id])

    const isBaseRun = useMemo(() => {
        if (evaluationRunData?.isBase !== undefined) {
            return Boolean(evaluationRunData.isBase)
        }
        return rawBaseRunId ? runId === rawBaseRunId : false
    }, [evaluationRunData?.isBase, rawBaseRunId, runId])

    const baseRunId = useMemo(() => {
        if (evaluationRunData?.isBase) return runId
        if (rawBaseRunId && typeof rawBaseRunId === "string") return rawBaseRunId
        return runId
    }, [evaluationRunData?.isBase, rawBaseRunId, runId])

    const comparisonRunsStepsAtomInstance = useMemo(
        () => comparisonRunsStepsAtom(comparisonRunIds),
        [comparisonRunIds],
    )
    const comparisonRunsSteps = useAtomValue(comparisonRunsStepsAtomInstance)
    // // Derive whether to show comparison mode
    const showComparisons = useMemo(
        () => Boolean(isBaseRun && comparisonRunIds.length > 0),
        [isBaseRun, comparisonRunIds],
    )
    const stepLoadable = useAtomValue(
        loadable(
            scenarioStepFamily({
                runId: runId!,
                scenarioId: scenarioId!,
            }),
        ),
    )

    const enricedRun = evaluationRunData?.enrichedRun
    const invocationStep = useMemo(() => stepLoadable.data?.invocationSteps?.[0], [stepLoadable])
    const {
        trace,
        value: outputValue,
        messageNodes,
        hasError,
    } = useInvocationResult({
        scenarioId: invocationStep?.scenarioId,
        stepKey: invocationStep?.stepKey,
        editorType: "simple",
        viewType: "single",
        runId,
    })

    const entries = useMemo(() => {
        const inputSteps = stepLoadable.data?.inputSteps

        if (stepLoadable.state !== "hasData" || !inputSteps) return []
        const out: {k: string; v: unknown}[] = []
        inputSteps.forEach((inputCol) => {
            let _inputs = {}
            try {
                const {testcase_dedup_id, ...rest} = inputCol.testcase.data
                _inputs = {...rest}
            } catch (e) {
                const rawInputs = (inputCol && (inputCol as any).inputs) || {}
                const {testcase_dedup_id, ...rest} = rawInputs as Record<string, unknown>
                _inputs = {...rest}
            }
            Object.entries(_inputs || {})?.forEach(([k, v]) => out.push({k: titleCase(k), v}))
        })
        return out
    }, [stepLoadable])

    // Base testcase id to match comparison scenarios by content
    const baseTestcaseId = useMemo(() => {
        const inputSteps = stepLoadable.data?.inputSteps
        const id = inputSteps?.[0]?.testcaseId
        return id
    }, [stepLoadable])

    // Map of comparison runId -> matched scenarioId (by testcaseId)
    const matchedComparisonScenarios = useMemo(() => {
        if (!showComparisons || !baseTestcaseId) return [] as {runId: string; scenarioId?: string}[]
        return comparisonRunIds.map((compRunId) => {
            const compMap =
                comparisonRunsSteps && typeof comparisonRunsSteps === "object"
                    ? ((comparisonRunsSteps as Record<string, any>)[compRunId] as any) || {}
                    : {}
            let matchedScenarioId: string | undefined
            for (const [scId, testcaseIds] of Object.entries<any>(compMap)) {
                const first = Array.isArray(testcaseIds) ? testcaseIds[0] : undefined
                if (first && first === baseTestcaseId) {
                    matchedScenarioId = scId
                    break
                }
            }
            return {runId: compRunId, scenarioId: matchedScenarioId}
        })
    }, [showComparisons, baseTestcaseId, comparisonRunsSteps, comparisonRunIds])

    const evaluatorMetrics = useMemo(() => {
        const evaluators = enricedRun?.evaluators
        return evaluators?.map((evaluator) => ({
            name: evaluator.name,
            metrics: evaluator.metrics,
            slug: evaluator.slug,
        }))
    }, [enricedRun])

    const openAndScrollTo = useCallback((key: string) => {
        // Ensure the related section is expanded when navigating via hash
        setActiveKeys((prev) => {
            const next = new Set(prev)
            next.add(key)
            if (key === "output" || key.startsWith("output-")) next.add("output")
            return Array.from(next)
        })

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
            const _step = stepLoadable.data?.steps?.find((s) => s.stepKey === evalSlug)

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
        const evaluatorSlug = enricedRun?.evaluators?.map((evaluator) => evaluator.slug) ?? []
        if (!evaluatorSlug.length) return

        setActiveKeys((prev) => {
            const next = new Set(prev)
            let changed = false

            evaluatorSlug.forEach((slug) => {
                if (!next.has(slug)) {
                    next.add(slug)
                    changed = true
                }
            })

            return changed ? Array.from(next) : prev
        })
    }, [enricedRun])

    useEffect(() => {
        const hash = appState.asPath?.split("#")[1]?.trim()
        if (!hash) return
        openAndScrollTo(hash)
    }, [appState.asPath, openAndScrollTo])

    // Sync horizontal scroll between the Collapse header (trace) and content box (output)
    const isSyncingScroll = useRef(false)
    useEffect(() => {
        if (!showComparisons) return

        const traceEl = document.querySelector(
            ".trace-scroll-container .ant-collapse-header",
        ) as HTMLDivElement | null
        const outputEl = document.querySelector(
            ".output-scroll-container .ant-collapse-content-box",
        ) as HTMLDivElement | null
        const evalEl = document.querySelector(
            ".evaluator-scroll-container .ant-collapse-content-box",
        ) as HTMLDivElement | null

        if (!traceEl || !outputEl) return

        const sync = (from: HTMLDivElement) => {
            const left = from.scrollLeft
            if (outputEl && from !== outputEl) outputEl.scrollLeft = left
            if (traceEl && from !== traceEl) traceEl.scrollLeft = left
            if (evalEl && from !== evalEl) evalEl.scrollLeft = left
        }

        const onTraceScroll = (e: any) => {
            if (isSyncingScroll.current) return
            isSyncingScroll.current = true
            sync(e.currentTarget as HTMLDivElement)
            requestAnimationFrame(() => (isSyncingScroll.current = false))
        }
        const onOutputScroll = (e: any) => {
            if (isSyncingScroll.current) return
            isSyncingScroll.current = true
            sync(e.currentTarget as HTMLDivElement)
            requestAnimationFrame(() => (isSyncingScroll.current = false))
        }
        const onEvalScroll = (e: any) => {
            if (isSyncingScroll.current) return
            isSyncingScroll.current = true
            sync(e.currentTarget as HTMLDivElement)
            requestAnimationFrame(() => (isSyncingScroll.current = false))
        }

        traceEl.addEventListener("scroll", onTraceScroll)
        outputEl.addEventListener("scroll", onOutputScroll)
        evalEl?.addEventListener("scroll", onEvalScroll)

        return () => {
            traceEl.removeEventListener("scroll", onTraceScroll)
            outputEl.removeEventListener("scroll", onOutputScroll)
            evalEl?.removeEventListener("scroll", onEvalScroll)
        }
    }, [showComparisons, activeKeys])

    const items: CollapseProps["items"] = useMemo(() => {
        if (stepLoadable.state !== "hasData" || !scenarioId) return []

        return [
            {
                key: "input",
                className: "!rounded-none [&_.ant-collapse-header]:!py-2",
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
                className:
                    "trace-scroll-container !rounded-none !px-0 [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-header]:overflow-x-auto [&_.ant-collapse-header]:scroll-mr-2 sticky -top-[13px] z-10 bg-white [&_.ant-collapse-header::-webkit-scrollbar]:!w-0 [&_.ant-collapse-header::-webkit-scrollbar]:!h-0",
                collapsible: "disabled",
                disabled: true,
                showArrow: false,
                label: (
                    <section
                        id="section-output"
                        className="shrink-0 h-[40px] px-1 flex items-center border-0 border-b border-t border-solid border-gray-200"
                    >
                        {showComparisons ? (
                            <>
                                <RunTraceHeader
                                    runId={baseRunId}
                                    scenarioId={scenarioId}
                                    stepKey={invocationStep?.stepkey}
                                    anchorId={`section-output-${baseRunId}`}
                                    showComparisons={showComparisons}
                                />
                                {matchedComparisonScenarios.map(
                                    ({runId: rId, scenarioId: scId}) => (
                                        <RunTraceHeader
                                            key={`trace-${rId}`}
                                            runId={rId}
                                            scenarioId={scId}
                                            stepKey={invocationStep?.stepkey}
                                            anchorId={`section-output-${rId}`}
                                            showComparisons={showComparisons}
                                        />
                                    ),
                                )}
                            </>
                        ) : (
                            <RunTraceHeader
                                runId={runId}
                                scenarioId={scenarioId}
                                stepKey={invocationStep?.stepkey}
                                showComparisons={showComparisons}
                            />
                        )}
                    </section>
                ),
            },
            {
                key: "output",
                label: <span className="font-medium">Outputs</span>,
                className: clsx([
                    "output-scroll-container",
                    "!rounded-none !px-0 [&_.ant-collapse-header]:!py-2 [&_.ant-collapse-content-box]:overflow-x-auto [&_.ant-collapse-content-box]:scroll-mr-2 [&_.ant-collapse-content-box::-webkit-scrollbar]:!w-0 [&_.ant-collapse-content-box::-webkit-scrollbar]:!h-0",
                    {"[&_.ant-collapse-content-box]:!px-1": showComparisons},
                ]),
                children: showComparisons ? (
                    <div className="w-full shrink-0 flex items-start">
                        <RunOutput
                            runId={baseRunId}
                            scenarioId={scenarioId}
                            stepKey={invocationStep?.stepkey}
                            showComparisons={showComparisons}
                        />
                        {matchedComparisonScenarios.map(({runId: rId, scenarioId: scId}) => (
                            <RunOutput
                                key={`output-${rId}`}
                                runId={rId}
                                scenarioId={scId}
                                stepKey={invocationStep?.stepkey}
                                showComparisons={showComparisons}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="min-h-0">
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
            ...(showComparisons
                ? [
                      {
                          key: "evaluators",
                          label: null,
                          disabled: true,
                          showArrow: false,
                          className:
                              "evaluator-scroll-container !rounded-none [&_.ant-collapse-header]:!hidden [&_.ant-collapse-content-box]:overflow-x-auto [&_.ant-collapse-content-box]:!px-0 [&_.ant-collapse-content-box::-webkit-scrollbar]:!w-0 [&_.ant-collapse-content-box::-webkit-scrollbar]:!h-0",
                          children: (() => {
                              const runs = [
                                  {runId: baseRunId, scenarioId},
                                  ...matchedComparisonScenarios.map((m) => ({
                                      runId: m.runId,
                                      scenarioId: m.scenarioId,
                                  })),
                              ]

                              // Helper: collect evaluator list for a run
                              const getRunEvaluators = (rId: string) => {
                                  const rState = evalAtomStore().get(evaluationRunStateFamily(rId))
                                  const evaluators = rState?.enrichedRun?.evaluators || []
                                  return Array.isArray(evaluators)
                                      ? evaluators
                                      : (Object.values(evaluators) as any[])
                              }

                              // Build ordered set of evaluator slugs (base run first, then others)
                              const slugOrder = new Set<string>()
                              const slugName: Record<string, string> = {}
                              runs.forEach(({runId: rId}) => {
                                  const list = getRunEvaluators(rId)
                                  list.forEach((ev: any) => {
                                      slugOrder.add(ev.slug)
                                      if (!slugName[ev.slug]) slugName[ev.slug] = ev.name || ev.slug
                                  })
                              })

                              // Renders the value UI for a single metric in a single run
                              const renderMetricCell = (
                                  rId: string,
                                  scId: string | undefined,
                                  evaluatorSlug: string,
                                  metricName: string,
                              ) => {
                                  if (!scId) {
                                      return (
                                          <Tag
                                              className="bg-[#0517290F] hover:bg-[#05172916]"
                                              bordered={false}
                                          >
                                              N/A
                                          </Tag>
                                      )
                                  }

                                  const metricData = evalAtomStore().get(
                                      runScopedMetricDataFamily({
                                          runId: rId,
                                          scenarioId: scId,
                                          metricKey: `${evaluatorSlug}.${metricName}`,
                                          stepSlug: invocationStep?.stepkey,
                                      }),
                                  )

                                  // Run-scoped error fallback
                                  let errorStep: any = null
                                  const stepLoadableR = evalAtomStore().get(
                                      loadable(scenarioStepFamily({runId: rId, scenarioId: scId})),
                                  ) as any
                                  if (stepLoadableR?.state === "hasData") {
                                      const _step = stepLoadableR?.data?.steps?.find(
                                          (s: any) => s.stepkey === evaluatorSlug,
                                      )
                                      if (failureRunTypes.includes(_step?.status)) {
                                          errorStep = {
                                              status: _step?.status,
                                              error:
                                                  _step?.error?.stacktrace || _step?.error?.message,
                                          }
                                      } else {
                                          const inv = stepLoadableR?.data?.invocationSteps?.find(
                                              (s: any) => s.scenarioId === scId,
                                          )
                                          if (failureRunTypes.includes(inv?.status)) {
                                              errorStep = {
                                                  status: inv?.status,
                                                  error:
                                                      inv?.error?.stacktrace || inv?.error?.message,
                                              }
                                          }
                                      }
                                  }

                                  if (errorStep?.status || errorStep?.error) {
                                      return (
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
                                      )
                                  }

                                  let value: any
                                  if (
                                      metricData?.value?.frequency &&
                                      metricData?.value?.frequency?.length > 0
                                  ) {
                                      const mostFrequent = metricData?.value?.frequency?.reduce(
                                          (max: any, current: any) =>
                                              current.count > max.count ? current : max,
                                      ).value
                                      value = String(mostFrequent)
                                  } else {
                                      const prim = Object.values(metricData?.value || {}).find(
                                          (v) => typeof v === "number" || typeof v === "string",
                                      )
                                      value =
                                          prim !== undefined
                                              ? prim
                                              : JSON.stringify(metricData?.value)
                                  }

                                  const formatted = formatMetricValue(metricName, value || "")

                                  const isLongText =
                                      typeof formatted === "string" &&
                                      (formatted.length > 180 || /\n/.test(formatted))

                                  if (
                                      formatted === undefined ||
                                      formatted === null ||
                                      formatted === ""
                                  ) {
                                      return (
                                          <Tag
                                              className="bg-[#0517290F] hover:bg-[#05172916]"
                                              bordered={false}
                                          >
                                              N/A
                                          </Tag>
                                      )
                                  }

                                  return isLongText ? (
                                      <SimpleSharedEditor
                                          key={`metric-${rId}-${scId}-${evaluatorSlug}-${metricName}`}
                                          handleChange={() => {}}
                                          initialValue={String(formatted)}
                                          editorType="borderless"
                                          state="readOnly"
                                          disabled
                                          readOnly
                                          editorClassName="!text-xs"
                                          placeholder="N/A"
                                          className="!w-[97.5%]"
                                      />
                                  ) : (
                                      <Tag
                                          className="bg-[#0517290F] hover:bg-[#05172916]"
                                          bordered={false}
                                      >
                                          {String(formatted)}
                                      </Tag>
                                  )
                              }

                              // Build the vertical list of evaluators with per-run metric columns
                              const orderedSlugs = Array.from(slugOrder)

                              return (
                                  <div className="w-full flex flex-col">
                                      {orderedSlugs.map((slug) => {
                                          // Figure out which runs used this evaluator
                                          const usedBy = new Set(
                                              runs
                                                  .filter(({runId: rId, scenarioId: scId}) => {
                                                      if (!scId) return false
                                                      const list = getRunEvaluators(rId)
                                                      return list.some((e: any) => e.slug === slug)
                                                  })
                                                  .map((r) => r.runId),
                                          )

                                          if (usedBy.size === 0) return null

                                          // Union of metric keys across participating runs only
                                          const metricKeyOrder = new Set<string>()
                                          runs.forEach(({runId: rId}) => {
                                              if (!usedBy.has(rId)) return
                                              const list = getRunEvaluators(rId)
                                              const ev = list.find((e: any) => e.slug === slug)
                                              Object.keys(ev?.metrics || {}).forEach((k) =>
                                                  metricKeyOrder.add(k),
                                              )
                                          })

                                          const keys = Array.from(metricKeyOrder)
                                          const displayName = slugName[slug] || slug

                                          return (
                                              <div
                                                  key={slug}
                                                  className="w-full"
                                                  id={`section-${slug}`}
                                              >
                                                  <div className="w-full shrink-0 flex items-stretch">
                                                      <div className="w-[500px] shrink-0 font-medium px-3 h-[48px] border-0 border-b border-t border-solid border-gray-200 flex items-center sticky left-0 z-10 bg-white">
                                                          <span className="">{displayName}</span>
                                                      </div>
                                                      {runs.slice(1).map((_, idx) => (
                                                          <div
                                                              key={`ph-${slug}-${idx}`}
                                                              className="w-[480px] shrink-0 h-[48px] border-0 border-b border-t border-solid border-gray-200"
                                                          />
                                                      ))}
                                                      <div className="flex-1 min-w-0 h-[48px] border-0 border-b border-t border-solid border-gray-200" />
                                                  </div>
                                                  <div className="w-full shrink-0 flex items-start">
                                                      {runs.map(
                                                          ({runId: rId, scenarioId: scId}) => {
                                                              const hasThis = usedBy.has(rId)
                                                              return (
                                                                  <div
                                                                      key={`run-${slug}-${rId}`}
                                                                      className="w-[480px] shrink-0 px-3 border-0 border-r border-solid border-white"
                                                                  >
                                                                      {hasThis ? (
                                                                          keys.map((metricName) => (
                                                                              <div
                                                                                  key={`${rId}-${scId}-${slug}-${metricName}`}
                                                                                  className="flex flex-col items-start gap-2 mb-3"
                                                                              >
                                                                                  <span>
                                                                                      {metricName}
                                                                                  </span>
                                                                                  {renderMetricCell(
                                                                                      rId,
                                                                                      scId,
                                                                                      slug,
                                                                                      metricName,
                                                                                  )}
                                                                              </div>
                                                                          ))
                                                                      ) : (
                                                                          // Support structure to preserve column spacing
                                                                          <div className="min-h-[1px]" />
                                                                      )}
                                                                  </div>
                                                              )
                                                          },
                                                      )}
                                                  </div>
                                              </div>
                                          )
                                      })}
                                  </div>
                              )
                          })(),
                      },
                  ]
                : (evaluatorMetrics || []).map((evaluator, idx) => {
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
                                  runScopedMetricDataFamily({
                                      runId: runId!,
                                      scenarioId: scenarioId!,
                                      metricKey: `${evaluator.slug}.${metricKey}`,
                                      stepSlug: invocationStep?.stepkey,
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
                                  value =
                                      prim !== undefined ? prim : JSON.stringify(metricData?.value)
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
                  })),
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
        comparisonRunIds,
        showComparisons,
        matchedComparisonScenarios,
        baseRunId,
        invocationStep?.stepkey,
    ])

    if (stepLoadable.state !== "hasData" || !enricedRun) {
        return <FocusDrawerContentSkeleton />
    }

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
