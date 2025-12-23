import {useMemo, useState} from "react"

import {MagnifyingGlass, SlidersHorizontal} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import {useLocalStorage} from "usehooks-ts"

import CustomTreeComponent from "@/oss/components/CustomUIs/CustomTreeComponent"
import {filterTree} from "@/oss/components/pages/observability/assets/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"

import TraceTreeSettings from "../../../TraceDrawer/components/TraceTreeSettings"
import {openTraceDrawerAtom} from "../../../TraceDrawer/store/traceDrawerStore"
import {useSessionDrawer} from "../../hooks/useSessionDrawer"

import {SessionTreeProps} from "./assets/types"

const SessionTree = ({selected, setSelected}: SessionTreeProps) => {
    const [searchValue, setSearchValue] = useState("")
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)

    const [traceTreeSettings, setTraceTreeSettings] = useLocalStorage("traceTreeSettings", {
        latency: true,
        cost: true,
        tokens: true,
    })
    const {sessionTraces, aggregatedStats} = useSessionDrawer()

    const turnsTree: TraceSpanNode[] = useMemo(() => {
        if (!sessionTraces) return []

        // Sort by start_time (ascending) - oldest first
        const sortedTraces = [...sessionTraces].sort((a: any, b: any) => {
            const timeA = new Date(a.start_time).getTime()
            const timeB = new Date(b.start_time).getTime()
            return timeA - timeB // Oldest first
        })

        return sortedTraces.map((trace, index) => ({
            ...trace,
            span_name: `Trace ${index + 1}`,
            // If we sort ascending (oldest first), the top one is the first trace.
            // UI:
            // - Trace 1
            // - Trace 2
            // - Trace 3

            expanded: false, // Collapse trace children by default
        }))
    }, [sessionTraces])

    const treeRoot = useMemo(() => {
        if (!turnsTree || !turnsTree.length) return undefined

        const rootLayout = {
            span_id: "root",
            span_name: "Session",
            children: turnsTree,
            attributes: {
                ag: {
                    metrics: {
                        tokens: {
                            cumulative: {
                                total: aggregatedStats?.total_tokens ?? 0,
                            },
                        },
                        costs: {
                            cumulative: {
                                total: aggregatedStats?.cost ?? 0,
                            },
                        },
                        duration: {
                            cumulative: aggregatedStats?.latency ?? 0,
                        },
                    },
                },
            },
            expanded: true, // Explicitly expand root
        } as any

        if (!searchValue.trim()) {
            return rootLayout
        }

        const result = filterTree(rootLayout, searchValue)
        if (!result) return rootLayout
        return result
    }, [turnsTree, searchValue, aggregatedStats])

    const filteredTree = treeRoot

    const handleSelect = (key: string) => {
        setSelected(key)
        const element = document.getElementById(key)
        if (element) {
            element.scrollIntoView({behavior: "smooth", block: "start"})
        }

        if (key === "root") return

        const isRootTrace = sessionTraces.some((trace: any) => trace.span_id === key)
        if (isRootTrace) return

        // It's a child node, find it and open the drawer
        let foundNode: any = null
        let parentTraceId: string | null = null

        const findNode = (nodes: any[], targetId: string, traceId: string) => {
            for (const node of nodes) {
                if (node.span_id === targetId) {
                    foundNode = node
                    parentTraceId = traceId
                    return
                }
                if (node.children) {
                    findNode(node.children, targetId, traceId)
                    if (foundNode) return
                }
            }
        }

        for (const trace of sessionTraces) {
            // We search inside the children of the session traces
            if (trace.children) {
                findNode(trace.children, key, trace.trace_id)
            }
            if (foundNode) break
        }

        if (foundNode && parentTraceId) {
            openTraceDrawer({
                traceId: parentTraceId,
                activeSpanId: foundNode.span_id,
            })
        }
    }

    return (
        <div className={"h-[92vh] overflow-hidden flex flex-col"}>
            <div className={clsx("flex items-center justify-between h-[43px] pl-2 pr-2")}>
                <Input
                    variant="borderless"
                    placeholder="Search in session"
                    prefix={<MagnifyingGlass size={14} className="text-gray-500 mr-2" />}
                    className="w-full"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    allowClear
                />

                <Popover
                    overlayInnerStyle={{padding: 0, width: 180}}
                    trigger="click"
                    content={
                        <TraceTreeSettings
                            settings={traceTreeSettings}
                            setSettings={setTraceTreeSettings}
                        />
                    }
                    placement="bottomRight"
                >
                    <Button icon={<SlidersHorizontal size={14} />} type="text" size="small" />
                </Popover>
            </div>
            <Divider type="horizontal" className="m-0" />
            <CustomTreeComponent
                data={filteredTree}
                settings={traceTreeSettings}
                selectedKey={selected}
                onSelect={handleSelect}
            />
        </div>
    )
}

export default SessionTree
