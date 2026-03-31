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
 * Check if a workflow span has an app reference (application or application_revision).
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

    const canOpenInPlayground = useMemo(() => {
        if (!activeTrace) return false
        const spanType = activeTrace.span_type

        if (spanType === "chat") {
            const agData = extractAgData(activeTrace)
            return Boolean(agData?.inputs)
        }

        if (spanType === "workflow") {
            return hasAppReference(activeTrace)
        }

        return false
    }, [activeTrace])

    const handleOpenInPlayground = useCallback(() => {
        if (!activeTrace) return
        const result = setOpenInPlayground(activeTrace)
        if (url.projectURL && result?.entityId) {
            if (result.appId) {
                // Workflow span with app reference → app playground
                const appPlaygroundBase = `${url.baseAppURL}/${result.appId}/playground`
                const playgroundUrl =
                    result.type === "revision"
                        ? `${appPlaygroundBase}?revisions=${result.entityId}`
                        : buildPlaygroundUrl([result.entityId], appPlaygroundBase)
                navigation.push(playgroundUrl)
            } else {
                // Chat span → project playground
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
                <Button
                    type="default"
                    size="small"
                    icon={<Play size={14} />}
                    disabled={!canOpenInPlayground}
                    onClick={handleOpenInPlayground}
                >
                    Playground
                </Button>
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
