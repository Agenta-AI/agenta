import {type ReactNode, useCallback, useMemo, useRef, useState} from "react"

import {extractAgData} from "@agenta/entities/trace"
import {richText, useT} from "@agenta/i18n"
import drawerCatalog from "@agenta/i18n/catalogs/observabilityUi.traceDrawer"
import spanCatalog from "@agenta/i18n/catalogs/observabilityUi.traceSpan"
import type {TraceSpanNode} from "@agenta/observability"
import {
    closeTraceDrawerAtom,
    getTraceDrawerPlaygroundActions,
    getTraceIdFromNode,
    traceDrawerBaseAppURLAtom,
    traceDrawerNavigate,
} from "@agenta/observability/traceDrawer"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {CopyIcon, DotsThree, ListPlus, Play, Trash} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {deleteTraceModalAtom} from "../delete/store/atom"

import {getTraceDrawerReferences} from "./referenceSlots"

/**
 * Span types whose inputs match the app's root input schema — the unit the
 * playground can replay. Covers the three SDK-`SERVER` types (`agent`,
 * `chain`, `workflow`; see `parse_span_kind` at
 * `sdk/agenta/sdk/engines/tracing/conventions.py:31`) plus `task`, which is
 * the default `type` for `@ag.instrument()` and therefore the root span of
 * every workflow decorated without an explicit `type=`.
 *
 * Span-type enum source: `sdk/agenta/sdk/models/tracing.py:29`
 * (re-exported by `api/oss/src/core/tracing/dtos.py:25`).
 */
const INVOCATION_SPAN_TYPES = new Set(["workflow", "task", "agent", "chain"])

/** True when a span tree contains an `agent`-type span (i.e. it's an agent run). */
const hasAgentSpan = (node: TraceSpanNode): boolean =>
    node.span_type === "agent" || (node.children ?? []).some((c) => hasAgentSpan(c))

interface TraceTopBarActionsProps {
    activeTrace: TraceSpanNode | undefined
    traces?: TraceSpanNode[]
    setSelectedTraceId?: (value: string) => void
}

/**
 * The actions of the trace view's top bar, for the active span: Add to test set, Annotate (the
 * one primary action), and a More menu with Add to annotation queue, Open in playground (disabled
 * with its reason), Copy span id and Delete trace.
 */
const TraceTopBarActions = ({activeTrace, traces, setSelectedTraceId}: TraceTopBarActionsProps) => {
    const t = useT(drawerCatalog, spanCatalog)
    const {AddToTestsetButton, AnnotateDrawerButton, AddToQueuePopover} = getTraceDrawerReferences()
    const {openTraceInPlayground, openWorkflowRevisionDrawer, hasAppReference, buildPlaygroundUrl} =
        getTraceDrawerPlaygroundActions()
    const setDeleteModalState = useSetAtom(deleteTraceModalAtom)
    const closeTraceDrawer = useSetAtom(closeTraceDrawerAtom)
    const baseAppURL = useAtomValue(traceDrawerBaseAppURLAtom)
    const [queueOpen, setQueueOpen] = useState(false)
    // The queue picker opens once the menu has closed, so the menu's focus return cannot close it.
    const openQueueAfterMenu = useRef(false)
    const spanIds = useMemo(
        () => (activeTrace?.span_id ? [activeTrace.span_id] : []),
        [activeTrace?.span_id],
    )
    const displayTrace = activeTrace || traces?.[0]
    const traceId = getTraceIdFromNode(displayTrace) || ""

    const openInPlaygroundState = useMemo<{enabled: boolean; reason?: ReactNode}>(() => {
        if (!activeTrace) {
            return {enabled: false, reason: t("observabilityUi.traceSpan.noSpanSelected")}
        }
        const spanType = activeTrace.span_type
        if (!spanType) {
            return {
                enabled: false,
                reason: (
                    <>
                        {richText(t("observabilityUi.traceSpan.typeNotSet"), {
                            code: (text) => <code>{text}</code>,
                            link: (text) => (
                                <a
                                    href="https://agenta.ai/docs/observability/trace-with-opentelemetry/semantic-conventions#agtype"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {text}
                                </a>
                            ),
                        })}
                    </>
                ),
            }
        }

        // OSS TraceSpanNode is the same backend span shape as the entities-package type
        // these helpers expect; align at the boundary, no data is converted.
        const agData = extractAgData(activeTrace as unknown as Parameters<typeof extractAgData>[0])
        const hasExtractableData = Boolean(agData?.inputs || agData?.parameters)
        const hasApp = hasAppReference?.(
            activeTrace as unknown as Parameters<typeof hasAppReference>[0],
        )
        const isInvocation = INVOCATION_SPAN_TYPES.has(spanType)

        // Invocation spans (workflow, task, agent, chain) represent the unit
        // that matches the app's root input schema — open them whenever we
        // have an app reference or any captured data to seed the testcase.
        if (isInvocation && (hasApp || hasExtractableData)) return {enabled: true}

        // Chat spans open ephemerally when we can reconstruct the prompt.
        if (spanType === "chat" && hasExtractableData) return {enabled: true}

        if (!hasApp && !hasExtractableData) {
            return {enabled: false, reason: t("observabilityUi.traceSpan.noWorkflowOrInputs")}
        }
        if (!hasApp) {
            return {
                enabled: false,
                reason: t("observabilityUi.traceSpan.needsWorkflowRef", {spanType}),
            }
        }
        if (!hasExtractableData) {
            return {enabled: false, reason: t("observabilityUi.traceSpan.noParamsOrInputs")}
        }
        return {enabled: false, reason: t("observabilityUi.traceSpan.cannotReplay", {spanType})}
    }, [activeTrace, hasAppReference, t])

    const handleOpenInPlayground = useCallback(async () => {
        if (!activeTrace) return
        // For an agent run, only the root invocation span carries the chat shape (messages
        // + agent config + session_id). Child spans (`invoke_agent`, `turn`, …) carry a bare
        // `{prompt}` and would open as a non-agent completion. So replay the whole agent run
        // from its root regardless of which span was clicked.
        const traceRoot = traces?.find((trace) => trace.trace_id === activeTrace.trace_id)
        const spanToOpen =
            traceRoot && traceRoot.span_id !== activeTrace.span_id && hasAgentSpan(traceRoot)
                ? traceRoot
                : activeTrace
        const result = await openTraceInPlayground?.(spanToOpen)
        // Need at least an entityId (revision or ephemeral) to open.
        if (!result || !result.entityId) return

        if (result.appId) {
            // A span with an app reference opens the app playground, so the drawer closes.
            closeTraceDrawer()
            const appPlaygroundBase = `${baseAppURL}/${result.appId}/playground`
            const playgroundUrl =
                result.type === "revision"
                    ? `${appPlaygroundBase}?revisions=${result.entityId}`
                    : (buildPlaygroundUrl?.([result.entityId], appPlaygroundBase) ??
                      appPlaygroundBase)
            void traceDrawerNavigate(playgroundUrl)
            return
        }

        // No app reference: the playground opens in the workflow revision drawer over the trace
        // drawer, in test mode (`expanded`), stacked so the trace drawer cannot take the focus.
        openWorkflowRevisionDrawer?.({
            entityId: result.entityId,
            context: "variant",
            expanded: true,
            stacked: true,
        })
    }, [
        activeTrace,
        traces,
        openTraceInPlayground,
        baseAppURL,
        buildPlaygroundUrl,
        openWorkflowRevisionDrawer,
        closeTraceDrawer,
    ])

    return (
        <div className="flex shrink-0 items-center gap-2">
            <AddToTestsetButton
                label={t("observabilityUi.traceSpan.addToTestset")}
                size="small"
                spanIds={spanIds}
                disabled={!activeTrace?.span_id}
            />
            <AnnotateDrawerButton
                label={t("observabilityUi.traceSpan.annotate")}
                size="small"
                variant="default"
                data={activeTrace?.annotations || []}
                traceSpanIds={{traceId: activeTrace?.trace_id, spanId: activeTrace?.span_id}}
                queryKey="trace-drawer-annotations"
                data-tour="annotate-button"
            />
            {/* The queue picker opens beside the More button, from the menu item. */}
            <AddToQueuePopover
                itemType="traces"
                itemIds={traceId ? [traceId] : []}
                open={queueOpen}
                onOpenChange={setQueueOpen}
                toggleOnTriggerClick={false}
            >
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("observabilityUi.traceDrawer.moreActions")}
                        >
                            <DotsThree size={16} weight="bold" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        className="w-72"
                        onCloseAutoFocus={(event) => {
                            if (!openQueueAfterMenu.current) return
                            openQueueAfterMenu.current = false
                            event.preventDefault()
                            setQueueOpen(true)
                        }}
                    >
                        <DropdownMenuItem
                            disabled={!traceId}
                            onSelect={() => {
                                openQueueAfterMenu.current = true
                            }}
                        >
                            <ListPlus size={14} />
                            {t("observabilityUi.traceDrawer.addToAnnotationQueue")}
                        </DropdownMenuItem>
                        {/* Only when the host binds the playground action; `/m` binds it only
                            while its playground view is on. */}
                        {openTraceInPlayground ? (
                            <DropdownMenuItem
                                disabled={!openInPlaygroundState.enabled}
                                onSelect={() => void handleOpenInPlayground()}
                                className="flex-col items-start"
                            >
                                <span className="inline-flex items-center gap-2">
                                    <Play size={14} />
                                    {t("observabilityUi.traceDrawer.openInPlayground")}
                                </span>
                                {openInPlaygroundState.reason ? (
                                    <span className="pl-5.5 text-meta text-muted-foreground">
                                        {openInPlaygroundState.reason}
                                    </span>
                                ) : null}
                            </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                            disabled={!activeTrace?.span_id}
                            onSelect={() => void copyToClipboard(activeTrace?.span_id ?? "")}
                        >
                            <CopyIcon size={14} />
                            {t("observabilityUi.traceDrawer.copySpanId")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            variant="destructive"
                            disabled={!displayTrace}
                            onSelect={() =>
                                setDeleteModalState({
                                    isOpen: true,
                                    traceIds: [traceId],
                                    onClose: () => setSelectedTraceId?.(""),
                                })
                            }
                        >
                            <Trash size={14} />
                            {t("observabilityUi.traceDrawer.deleteTrace")}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </AddToQueuePopover>
        </div>
    )
}

export default TraceTopBarActions
