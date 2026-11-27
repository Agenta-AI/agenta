import {useState, type ReactNode} from "react"

import {TILE_MISSING} from "@agenta/entities/evaluationRun"
import type {TraceSpan} from "@agenta/entities/trace"
import {formatDate, useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {ReferenceChipList, type TraceReference} from "@agenta/observability-ui/traceDrawer"
import {
    formatCurrency,
    formatLatency,
    formatTokens,
    splitTokenUsage,
    type TokenBreakdown,
} from "@agenta/shared/utils"
import {TokenBreakdownList} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {useSetAtom} from "jotai"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

import {ScenarioSection} from "./ScenarioSection"
import {executionMetricsOf} from "./ScenarioStepTools"
import type {useScenarioTrace} from "./useScenarioTrace"

const numberAt = (value: unknown, path: string[]): number | undefined => {
    const found = path.reduce<unknown>(
        (current, key) =>
            typeof current === "object" && current !== null
                ? (current as Record<string, unknown>)[key]
                : undefined,
        value,
    )
    return typeof found === "number" ? found : undefined
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const Pair = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-meta text-muted-foreground">{label}</span>
        <span className="break-words text-body-sm tabular-nums">{children}</span>
    </div>
)

/** An id with a copy link at the end of its row. */
const IdRow = ({label, value, action}: {label: string; value: string; action: ReactNode}) => (
    <div className="grid min-w-0 grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-solid border-border-muted py-2">
        <span className="text-meta text-muted-foreground">{label}</span>
        <span className="truncate font-mono text-code-sm">{value}</span>
        {action}
    </div>
)

const CopyLink = ({value}: {value: string}) => {
    const t = useT(valueViewCatalog)
    const [copied, setCopied] = useState(false)
    return (
        <Button
            variant="link"
            size="xs"
            onClick={async () => setCopied(await copyToClipboard(value))}
        >
            {t(copied ? "chat.valueView.copied" : "chat.valueView.copyValue")}
        </Button>
    )
}

/**
 * The Metadata tab: the app call's metrics (status, start, duration, tokens with their split,
 * cost, tool calls) as label and value pairs, then the references of the test case as one chip
 * per entity and its ids.
 */
export const ScenarioFocusMetadataTab = ({
    row,
    trace,
}: {
    row: ScenarioRow
    trace: ReturnType<typeof useScenarioTrace>
}) => {
    const t = useT(focusCatalog, valueViewCatalog)
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
    const toggle = (key: string) =>
        setFolded((previous) => {
            const next = new Set(previous)
            if (!next.delete(key)) next.add(key)
            return next
        })
    const metrics = executionMetricsOf(row.metrics)
    const root: TraceSpan | null = trace.root
    const tokensAt = (key: string) =>
        numberAt(root?.attributes, ["ag", "metrics", "tokens", "cumulative", key])
    const prompt = tokensAt("prompt")
    const completion = tokensAt("completion")
    const total = metrics.totalTokens ?? tokensAt("total")
    // With no cached tokens there is no split to make: the prompt and completion are the parts.
    const breakdown: TokenBreakdown | null =
        splitTokenUsage({prompt, completion, total}) ??
        (prompt !== undefined && completion !== undefined
            ? {
                  input: prompt,
                  cacheRead: 0,
                  cacheWrite: 0,
                  output: completion,
                  total: total ?? prompt + completion,
              }
            : null)
    const started = root?.start_time ? new Date(root.start_time) : null
    const show = (value: number | undefined, format: (value: number) => string) =>
        value === undefined ? TILE_MISSING : format(value)
    const traceId = row.invocation?.traceId ?? null

    return (
        <div className="flex flex-col gap-4">
            <ScenarioSection
                label={t("evaluations.scenarioFocus.metrics")}
                title={t("evaluations.scenarioFocus.metrics")}
                collapsed={folded.has("metrics")}
                onToggle={() => toggle("metrics")}
            >
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 pl-4.5 sm:grid-cols-2">
                    <Pair label={t("evaluations.scenarioFocus.status")}>
                        {row.invocation?.status ? capitalized(row.invocation.status) : TILE_MISSING}
                    </Pair>
                    <Pair label={t("evaluations.scenarioFocus.started")}>
                        {started && !Number.isNaN(started.getTime())
                            ? formatDate(started, {dateStyle: "medium", timeStyle: "medium"})
                            : TILE_MISSING}
                    </Pair>
                    <Pair label={t("evaluations.scenarioFocus.duration")}>
                        {show(metrics.durationMs, (ms) => formatLatency(ms / 1000))}
                    </Pair>
                    <Pair label={t("evaluations.scenarioFocus.tokens")}>
                        {breakdown ? (
                            <span className="block max-w-60">
                                <TokenBreakdownList breakdown={breakdown} />
                            </span>
                        ) : (
                            show(total, formatTokens)
                        )}
                    </Pair>
                    <Pair label={t("evaluations.scenarioFocus.estimatedCost")}>
                        {show(metrics.totalCost, formatCurrency)}
                    </Pair>
                    {trace.toolCallCount > 0 ? (
                        <Pair label={t("evaluations.scenarioFocus.toolCallCount")}>
                            {trace.toolCallCount}
                        </Pair>
                    ) : null}
                </div>
            </ScenarioSection>
            <ScenarioSection
                label={t("evaluations.scenarioFocus.references")}
                title={t("evaluations.scenarioFocus.references")}
                collapsed={folded.has("references")}
                onToggle={() => toggle("references")}
            >
                <div className="flex flex-col gap-2 pl-4.5">
                    <ReferenceChipList references={(root?.references ?? []) as TraceReference[]} />
                    <div className="flex flex-col">
                        {row.testcaseId ? (
                            <IdRow
                                label={t("evaluations.scenarioFocus.testcaseId")}
                                value={row.testcaseId}
                                action={<CopyLink value={row.testcaseId} />}
                            />
                        ) : null}
                        <IdRow
                            label={t("evaluations.scenarioFocus.scenarioId")}
                            value={row.scenario.id}
                            action={<CopyLink value={row.scenario.id} />}
                        />
                        {traceId ? (
                            <IdRow
                                label={t("evaluations.scenarioFocus.trace")}
                                value={traceId}
                                action={
                                    <Button
                                        variant="link"
                                        size="xs"
                                        onClick={() => openTrace({traceId})}
                                    >
                                        {t("chat.valueView.openTrace")}
                                    </Button>
                                }
                            />
                        ) : null}
                    </div>
                </div>
            </ScenarioSection>
        </div>
    )
}
