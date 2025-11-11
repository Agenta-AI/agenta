import {useCallback, useEffect, useMemo, useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, SidebarSimple} from "@phosphor-icons/react"
import {Button, Space, Tag, Typography} from "antd"
import {useAtomValue} from "jotai"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
import {fetchAllPreviewTraces} from "@/oss/services/tracing/api"
import {
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {useObservability} from "@/oss/state/newObservability"
import buildTraceQueryParams from "@/oss/state/newObservability/utils/buildTraceQueryParams"

import DeleteTraceModal from "../../components/DeleteTraceModal"

import {useStyles} from "./assets/styles"
import {TraceHeaderProps} from "./assets/types"

const getTraceIdFromNode = (node: any): string | null => {
    if (!node) return null
    return (
        node.trace_id ||
        node.invocationIds?.trace_id ||
        node.node?.trace_id ||
        node.root?.id ||
        null
    )
}

const getSpanIdFromNode = (node: any): string | null => {
    if (!node) return null
    return node.span_id || node.invocationIds?.span_id || node.node?.span_id || null
}

const getNodeTimestamp = (node: any): string | number | null => {
    if (!node) return null
    return (
        node.start_time ||
        node.startTime ||
        node.timestamp ||
        node.created_at ||
        node.createdAt ||
        node.node?.start_time ||
        node.node?.timestamp ||
        node.node?.created_at ||
        null
    )
}

const toISOString = (value: string | number | Date | null | undefined): string | null => {
    if (value === null || value === undefined) return null
    let date: Date
    if (value instanceof Date) {
        date = value
    } else if (typeof value === "number") {
        const ms = value < 1e12 ? value * 1000 : value
        date = new Date(ms)
    } else {
        date = new Date(value)
    }
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString()
}

type NavSource = "table" | "remote"

interface NavState {
    candidate: TraceSpanNode | null
    loading: boolean
    source: NavSource | null
}

const TraceHeader = ({
    activeTrace: propActiveTrace,
    traces: drawerTraces,
    activeTraceId,
    traceId,
    traceTabs,
    filters,
    sort,
    limit,
    setSelectedTraceId,
    setSelectedNode,
    setTraceParam,
    setSpanParam,
    setTraceDrawerTrace,
    activeTraceIndex: _activeTraceIndex,
    setIsAnnotationsSectionOpen,
    isAnnotationsSectionOpen,
    setSelected,
}: TraceHeaderProps) => {
    const classes = useStyles()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

    const {traces: tableTracesRaw, hasMoreTraces, fetchMoreTraces} = useObservability()
    const appId = useAtomValue(selectedAppIdAtom)

    const tableTraces = useMemo(() => tableTracesRaw as TraceSpanNode[], [tableTracesRaw])

    const focusMode: "trace" | "span" = traceTabs === "trace" ? "trace" : "span"

    const activeTrace = useMemo(() => {
        if (propActiveTrace) return propActiveTrace
        if (!Array.isArray(drawerTraces)) return undefined
        return (drawerTraces as TraceSpanNode[]).find(
            (node) => getSpanIdFromNode(node) === activeTraceId,
        )
    }, [propActiveTrace, drawerTraces, activeTraceId])

    const activeSpanKey = useMemo(() => {
        return getSpanIdFromNode(activeTrace) || activeTraceId || null
    }, [activeTrace, activeTraceId])

    const activeTraceKey = useMemo(() => {
        return getTraceIdFromNode(activeTrace) || traceId || null
    }, [activeTrace, traceId])

    const activeFocusKey = focusMode === "span" ? activeSpanKey : activeTraceKey

    const activeTimestampIso = useMemo(
        () => toISOString(getNodeTimestamp(activeTrace)),
        [activeTrace],
    )

    const filtersKey = useMemo(() => JSON.stringify(filters ?? []), [filters])
    const sortKey = useMemo(() => JSON.stringify(sort ?? {}), [sort])

    const baseParams = useMemo(
        () =>
            buildTraceQueryParams({
                focus: traceTabs,
                filters,
                sort,
                limit,
            }),
        [traceTabs, filtersKey, sortKey, limit],
    )

    const requestSize = useMemo(() => {
        if (!limit || Number.isNaN(limit)) return 5
        return Math.max(1, Math.min(limit, 10))
    }, [limit])

    const tableSpanKeySet = useMemo(() => {
        const set = new Set<string>()
        tableTraces.forEach((item) => {
            const key = getSpanIdFromNode(item)
            if (key) set.add(key)
        })
        return set
    }, [tableTraces])

    const tableTraceKeySet = useMemo(() => {
        const set = new Set<string>()
        tableTraces.forEach((item) => {
            const key = getTraceIdFromNode(item)
            if (key) set.add(key)
        })
        return set
    }, [tableTraces])

    const tableIndex = useMemo(() => {
        if (!activeFocusKey) return -1
        return tableTraces.findIndex((item) => {
            const key = focusMode === "span" ? getSpanIdFromNode(item) : getTraceIdFromNode(item)
            return key === activeFocusKey
        })
    }, [tableTraces, focusMode, activeFocusKey])

    const prevFromTable =
        tableIndex > 0 && tableIndex < tableTraces.length
            ? (tableTraces[tableIndex - 1] as TraceSpanNode)
            : null

    const nextFromTable =
        tableIndex >= 0 && tableIndex < tableTraces.length - 1
            ? (tableTraces[tableIndex + 1] as TraceSpanNode)
            : null

    const [prevNav, setPrevNav] = useState<NavState>({
        candidate: null,
        loading: false,
        source: null,
    })
    const [nextNav, setNextNav] = useState<NavState>({
        candidate: null,
        loading: false,
        source: null,
    })

    const fetchRelativeTrace = useCallback(
        async (direction: "prev" | "next"): Promise<TraceSpanNode | null> => {
            if (!appId || !activeTimestampIso || !activeFocusKey) {
                console.debug("[TraceNav] skip fetch – missing context", {
                    direction,
                    appId,
                    activeTimestampIso,
                    activeFocusKey,
                })
                return null
            }

            console.debug("[TraceNav] fetchRelative:start", {
                direction,
                focusMode,
                activeTimestampIso,
                activeFocusKey,
            })

            const params: Record<string, any> = {...baseParams, size: requestSize}

            if (direction === "next") {
                params.newest = activeTimestampIso
                if (baseParams.oldest) params.oldest = baseParams.oldest
            } else {
                params.oldest = activeTimestampIso
                if (baseParams.newest) params.newest = baseParams.newest
            }

            try {
                const response = await fetchAllPreviewTraces(params, appId)

                console.debug("[TraceNav] fetchRelative:response", {
                    direction,
                    hasTraces: Boolean((response as any)?.traces),
                    hasSpans: Boolean((response as any)?.spans),
                })
                let candidates: TraceSpanNode[] = []

                if (isTracesResponse(response)) {
                    candidates = transformTracingResponse(transformTracesResponseToTree(response))
                } else if (isSpansResponse(response)) {
                    candidates = transformTracingResponse(response.spans)
                } else if (Array.isArray((response as any)?.spans)) {
                    candidates = transformTracingResponse((response as any).spans)
                }

                if (!candidates.length) return null

                const focusKeyGetter =
                    focusMode === "trace" ? getTraceIdFromNode : getSpanIdFromNode

                const filtered = candidates.filter((item) => {
                    const candidateKey = focusKeyGetter(item)
                    if (!candidateKey || candidateKey === activeFocusKey) return false
                    if (focusMode === "trace") {
                        if (tableTraceKeySet.has(candidateKey)) return false
                    } else if (tableSpanKeySet.has(candidateKey)) {
                        return false
                    }
                    return true
                })

                console.debug("[TraceNav] fetchRelative:filtered", {
                    direction,
                    total: candidates.length,
                    filtered: filtered.length,
                    firstSpan: filtered[0]?.span_id,
                    firstTrace: filtered[0]?.trace_id,
                })

                if (!filtered.length) {
                    console.debug("[TraceNav] no filtered candidates", {direction})
                    return null
                }

                return filtered[0]
            } catch (error) {
                console.error("Trace navigation fetch failed", error)
                return null
            }
        },
        [
            appId,
            activeTimestampIso,
            activeFocusKey,
            baseParams,
            focusMode,
            requestSize,
            tableSpanKeySet,
            tableTraceKeySet,
        ],
    )

    useEffect(() => {
        if (prevFromTable) {
            console.debug("[TraceNav] prev candidate from table", {
                spanId: getSpanIdFromNode(prevFromTable),
                traceId: getTraceIdFromNode(prevFromTable),
            })
            setPrevNav({candidate: prevFromTable, loading: false, source: "table"})
            return
        }

        if (!activeTimestampIso || !appId || !activeFocusKey) {
            console.debug("[TraceNav] prev disabled – missing context")
            setPrevNav({candidate: null, loading: false, source: null})
            return
        }

        let cancelled = false
        setPrevNav({candidate: null, loading: true, source: null})

        fetchRelativeTrace("prev").then((result) => {
            if (cancelled) return
            console.debug("[TraceNav] prev fetch result", {
                spanId: getSpanIdFromNode(result),
                traceId: getTraceIdFromNode(result),
            })
            setPrevNav({candidate: result, loading: false, source: result ? "remote" : null})
        })

        return () => {
            cancelled = true
        }
    }, [prevFromTable, fetchRelativeTrace, activeTimestampIso, appId, activeFocusKey])

    useEffect(() => {
        if (nextFromTable) {
            console.debug("[TraceNav] next candidate from table", {
                spanId: getSpanIdFromNode(nextFromTable),
                traceId: getTraceIdFromNode(nextFromTable),
            })
            setNextNav({candidate: nextFromTable, loading: false, source: "table"})
            return
        }

        if (!activeTimestampIso || !appId || !activeFocusKey) {
            console.debug("[TraceNav] next disabled – missing context")
            setNextNav({candidate: null, loading: false, source: null})
            return
        }

        if (tableIndex >= 0 && !hasMoreTraces) {
            console.debug("[TraceNav] next disabled – end of results")
            setNextNav({candidate: null, loading: false, source: null})
            return
        }

        let cancelled = false
        setNextNav({candidate: null, loading: true, source: null})

        fetchRelativeTrace("next").then((result) => {
            if (cancelled) return
            console.debug("[TraceNav] next fetch result", {
                spanId: getSpanIdFromNode(result),
                traceId: getTraceIdFromNode(result),
            })
            setNextNav({candidate: result, loading: false, source: result ? "remote" : null})
        })

        return () => {
            cancelled = true
        }
    }, [
        nextFromTable,
        fetchRelativeTrace,
        activeTimestampIso,
        appId,
        activeFocusKey,
        hasMoreTraces,
        tableIndex,
    ])

    const navigateToTarget = useCallback(
        (target: TraceSpanNode | null, source: NavSource | null) => {
            if (!target) return

            const targetTraceId = getTraceIdFromNode(target)
            const targetSpanId = getSpanIdFromNode(target)

            console.debug("[TraceNav] navigate", {
                source,
                focusMode,
                targetTraceId,
                targetSpanId,
            })

            setTraceParam(targetTraceId ?? undefined, {shallow: true})

            if (targetTraceId) {
                setTraceDrawerTrace({traceId: targetTraceId, activeSpanId: targetSpanId ?? null})
            }

            if (source === "table") {
                const selectionKey =
                    focusMode === "span"
                        ? (targetSpanId ?? targetTraceId ?? undefined)
                        : (targetTraceId ?? targetSpanId ?? undefined)

                if (selectionKey) {
                    console.debug("[TraceNav] setSelectedTraceId", selectionKey)
                    setSelectedTraceId(selectionKey)
                }
            }

            if (targetSpanId) {
                console.debug("[TraceNav] setSelectedNode", targetSpanId)
                setSelectedNode?.(targetSpanId)
                setSelected?.(targetSpanId)
            } else {
                console.debug("[TraceNav] clear SelectedNode")
                setSelectedNode?.("")
                setSelected?.("")
            }

            if (focusMode === "span") {
                console.debug("[TraceNav] setSpanParam", targetSpanId)
                setSpanParam(targetSpanId ?? undefined, {shallow: true})
            } else {
                console.debug("[TraceNav] clear span param")
                setSpanParam(undefined, {shallow: true})
            }
        },
        [
            focusMode,
            setSelectedTraceId,
            setSelectedNode,
            setSelected,
            setTraceParam,
            setSpanParam,
            setTraceDrawerTrace,
        ],
    )

    const handlePrevTrace = useCallback(() => {
        if (prevNav.loading || !prevNav.candidate) return
        console.debug("[TraceNav] handlePrev", {
            source: prevNav.source,
            spanId: getSpanIdFromNode(prevNav.candidate),
            traceId: getTraceIdFromNode(prevNav.candidate),
        })
        navigateToTarget(prevNav.candidate, prevNav.source)
    }, [prevNav, navigateToTarget])

    const handleNextTrace = useCallback(async () => {
        if (nextNav.loading || !nextNav.candidate) return

        console.debug("[TraceNav] handleNext", {
            source: nextNav.source,
            spanId: getSpanIdFromNode(nextNav.candidate),
            traceId: getTraceIdFromNode(nextNav.candidate),
        })

        if (nextNav.source === "remote" && hasMoreTraces) {
            try {
                console.debug("[TraceNav] fetchMoreTraces before navigating")
                await fetchMoreTraces()
            } catch (error) {
                console.error("Failed to fetch additional traces", error)
            }
        }

        navigateToTarget(nextNav.candidate, nextNav.source)
    }, [nextNav, hasMoreTraces, fetchMoreTraces, navigateToTarget])

    const isPrevDisabled = prevNav.loading || !prevNav.candidate || !activeFocusKey
    const isNextDisabled = nextNav.loading || !nextNav.candidate || !activeFocusKey

    const displayTrace = propActiveTrace || drawerTraces?.[0]

    return (
        <>
            <div className="flex items-center justify-between">
                <Space>
                    <div>
                        <Button
                            onClick={handlePrevTrace}
                            type="text"
                            disabled={isPrevDisabled}
                            icon={<CaretUp size={16} />}
                        />
                        <Button
                            onClick={handleNextTrace}
                            type="text"
                            disabled={isNextDisabled}
                            icon={<CaretDown size={16} />}
                        />
                    </div>

                    <Typography.Text className={classes.title}>Trace</Typography.Text>
                    <TooltipWithCopyAction
                        copyText={getTraceIdFromNode(displayTrace) || ""}
                        title="Copy trace id"
                    >
                        <Tag className="font-normal">
                            # {getTraceIdFromNode(displayTrace) || "-"}
                        </Tag>
                    </TooltipWithCopyAction>
                </Space>

                <Space>
                    <Button
                        icon={<DeleteOutlined />}
                        onClick={() => setIsDeleteModalOpen(true)}
                        disabled={!displayTrace}
                    />
                    {setIsAnnotationsSectionOpen && (
                        <Button
                            icon={<SidebarSimple size={14} />}
                            type={isAnnotationsSectionOpen ? "default" : "primary"}
                            className="shrink-0 flex items-center justify-center"
                            onClick={() => setIsAnnotationsSectionOpen((prev) => !prev)}
                        />
                    )}
                </Space>
            </div>

            <DeleteTraceModal
                open={isDeleteModalOpen}
                onCancel={() => setIsDeleteModalOpen(false)}
                activeTraceId={getTraceIdFromNode(displayTrace) || ""}
                setSelectedTraceId={setSelectedTraceId}
            />
        </>
    )
}

export default TraceHeader
