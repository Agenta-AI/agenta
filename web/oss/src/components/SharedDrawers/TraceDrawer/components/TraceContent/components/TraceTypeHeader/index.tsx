import {useCallback, useMemo} from "react"

import {extractAgData} from "@agenta/entities/trace"
import {CopyTooltip as TooltipWithCopyAction} from "@agenta/ui/copy-tooltip"
import {DeleteOutlined} from "@ant-design/icons"
import {Play, SidebarSimple} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import AddToTestsetButton from "@/oss/components/SharedDrawers/AddToTestsetDrawer/components/AddToTestsetButton"
import AnnotateDrawerButton from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/AnnotateDrawerButton"
import {openTraceInPlaygroundAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/openInPlayground"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useAppNavigation} from "@/oss/state/appState"
import {urlAtom} from "@/oss/state/url"
import {buildPlaygroundUrl} from "@/oss/state/url/playground"

import {deleteTraceModalAtom} from "../../../DeleteTraceModal/store/atom"
import {getTraceIdFromNode} from "../../../TraceHeader/assets/helper"

import {TraceTypeHeaderProps} from "./types"

const DeleteTraceModal = dynamic(() => import("../../../DeleteTraceModal"), {
    ssr: false,
})

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

/**
 * Check if a span has an app reference (application or application_revision).
 * Checks ag.references (dict format) and top-level references array.
 */
function hasAppReference(span: TraceSpanNode): boolean {
    const attrs = span.attributes as Record<string, unknown> | undefined
    const ag = attrs?.ag as Record<string, unknown> | undefined
    const agRefs = ag?.references as Record<string, unknown> | undefined
    if (agRefs?.application || agRefs?.application_revision) return true

    const topRefs = span.references as {attributes?: {key?: string}}[] | undefined
    if (Array.isArray(topRefs)) {
        return topRefs.some(
            (ref) =>
                ref.attributes?.key === "application" ||
                ref.attributes?.key === "application_revision",
        )
    }
    return false
}

const TraceTypeHeader = ({
    activeTrace,
    error,
    traces,
    setSelectedTraceId,
    setIsAnnotationsSectionOpen,
    isAnnotationsSectionOpen,
}: TraceTypeHeaderProps) => {
    const setDeleteModalState = useSetAtom(deleteTraceModalAtom)
    const setOpenInPlayground = useSetAtom(openTraceInPlaygroundAtom)
    const url = useAtomValue(urlAtom)
    const navigation = useAppNavigation()
    const spanIds = useMemo(() => {
        if (!activeTrace?.span_id) return []
        return [activeTrace.span_id]
    }, [activeTrace?.span_id])

    const openInPlaygroundState = useMemo<{enabled: boolean; reason?: string}>(() => {
        if (!activeTrace) {
            return {enabled: false, reason: "No trace span is selected."}
        }
        const spanType = activeTrace.span_type
        if (!spanType) {
            return {enabled: false, reason: "This span has no type information."}
        }

        const agData = extractAgData(activeTrace)
        const hasExtractableData = Boolean(agData?.inputs || agData?.parameters)
        const hasApp = hasAppReference(activeTrace)
        const isInvocation = INVOCATION_SPAN_TYPES.has(spanType)

        // Invocation spans (workflow, task, agent, chain) represent the unit
        // that matches the app's root input schema — open them whenever we
        // have an app reference or any captured data to seed the testcase.
        if (isInvocation && (hasApp || hasExtractableData)) return {enabled: true}

        // Chat spans open ephemerally when we can reconstruct the prompt.
        if (spanType === "chat" && hasExtractableData) return {enabled: true}

        if (!hasApp && !hasExtractableData) {
            return {
                enabled: false,
                reason: "This span has no application reference or captured inputs to replay in the playground.",
            }
        }
        if (!hasApp) {
            return {
                enabled: false,
                reason: `"${spanType}" spans need an application reference to be opened in the playground.`,
            }
        }
        if (!hasExtractableData) {
            return {
                enabled: false,
                reason: "This span has an application reference but no captured parameters or inputs to open.",
            }
        }
        return {
            enabled: false,
            reason: `"${spanType}" spans can't be replayed in the playground — open the parent workflow, task, agent, or chain span instead.`,
        }
    }, [activeTrace])

    const canOpenInPlayground = openInPlaygroundState.enabled

    const handleOpenInPlayground = useCallback(() => {
        if (!activeTrace) return
        const result = setOpenInPlayground(activeTrace)
        if (url.projectURL && result?.entityId) {
            if (result.appId) {
                // Span with an app reference → app playground
                const appPlaygroundBase = `${url.baseAppURL}/${result.appId}/playground`
                const playgroundUrl =
                    result.type === "revision"
                        ? `${appPlaygroundBase}?revisions=${result.entityId}`
                        : buildPlaygroundUrl([result.entityId], appPlaygroundBase)
                navigation.push(playgroundUrl)
            } else {
                // No app reference → project playground as an ephemeral session
                const playgroundUrl = buildPlaygroundUrl(
                    [result.entityId],
                    `${url.projectURL}/playground`,
                )
                navigation.push(playgroundUrl)
            }
        }
    }, [activeTrace, setOpenInPlayground, url.projectURL, url.baseAppURL, navigation])

    const displayTrace = activeTrace || traces?.[0]

    return (
        <div className="h-10 px-4 flex items-center justify-between gap-2 border-0 border-b border-solid border-colorSplit">
            <Tooltip
                placement="topLeft"
                title={activeTrace?.span_name || (error ? "Error" : "")}
                mouseEnterDelay={0.25}
            >
                <Typography.Text
                    className={clsx("truncate text-nowrap flex-1 text-sm font-medium")}
                >
                    {activeTrace?.span_name || (error ? "Error" : "")}
                </Typography.Text>
            </Tooltip>

            <div className="flex gap-2">
                <TooltipWithCopyAction
                    copyText={activeTrace?.span_id || ""}
                    title="Copy span id"
                    tooltipProps={{placement: "bottom", arrow: true}}
                >
                    <Tag className="font-mono truncate bg-[#0517290F]" variant="filled">
                        # {activeTrace?.span_id || "-"}
                    </Tag>
                </TooltipWithCopyAction>
                <Tooltip
                    title={!canOpenInPlayground ? openInPlaygroundState.reason : undefined}
                    placement="bottom"
                >
                    <Button
                        type="default"
                        size="small"
                        icon={<Play size={14} />}
                        disabled={!canOpenInPlayground}
                        onClick={handleOpenInPlayground}
                    >
                        Playground
                    </Button>
                </Tooltip>
                <AddToTestsetButton
                    label="Add to testset"
                    size="small"
                    spanIds={spanIds}
                    disabled={!activeTrace?.span_id}
                />
                <AnnotateDrawerButton
                    label="Annotate"
                    size="small"
                    data={activeTrace?.annotations || []}
                    traceSpanIds={{
                        traceId: activeTrace?.trace_id,
                        spanId: activeTrace?.span_id,
                    }}
                    queryKey="trace-drawer-annotations"
                    data-tour="annotate-button"
                />

                <Button
                    icon={<DeleteOutlined />}
                    onClick={() =>
                        setDeleteModalState({
                            isOpen: true,
                            traceIds: [getTraceIdFromNode(displayTrace) || ""],
                            onClose: () => {
                                if (setSelectedTraceId) setSelectedTraceId("")
                            },
                        })
                    }
                    disabled={!displayTrace}
                    size="small"
                />
                {setIsAnnotationsSectionOpen && (
                    <Button
                        icon={<SidebarSimple size={14} />}
                        type={isAnnotationsSectionOpen ? "default" : "primary"}
                        className="shrink-0 flex items-center justify-center"
                        onClick={() => setIsAnnotationsSectionOpen((prev) => !prev)}
                        size="small"
                    />
                )}
            </div>

            <DeleteTraceModal />
        </div>
    )
}

export default TraceTypeHeader
