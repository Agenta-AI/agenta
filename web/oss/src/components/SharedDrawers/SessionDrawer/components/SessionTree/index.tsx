import {useMemo, useState} from "react"

import {MagnifyingGlass, SlidersHorizontal} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover} from "antd"
import clsx from "clsx"
import {useLocalStorage} from "usehooks-ts"

import CustomTreeComponent from "@/oss/components/CustomUIs/CustomTreeComponent"
import {filterTree} from "@/oss/components/pages/observability/assets/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"

import TraceTreeSettings from "../../../TraceDrawer/components/TraceTreeSettings"
import {useSessionDrawer} from "../../hooks/useSessionDrawer"

import {SessionTreeProps} from "./assets/types"

const SessionTree = ({selected, setSelected}: SessionTreeProps) => {
    const [searchValue, setSearchValue] = useState("")

    const [traceTreeSettings, setTraceTreeSettings] = useLocalStorage("traceTreeSettings", {
        latency: true,
        cost: true,
        tokens: true,
    })
    const {sessionTraces, aggregatedStats} = useSessionDrawer()

    const turnsTree: TraceSpanNode[] = useMemo(() => {
        if (!sessionTraces) return []

        // Sort by start_time (descending) - assuming start_time exists
        const sortedTraces = [...sessionTraces].sort((a: any, b: any) => {
            const timeA = new Date(a.start_time).getTime()
            const timeB = new Date(b.start_time).getTime()
            return timeB - timeA // Newest first
        })

        return sortedTraces.map((trace, index) => ({
            ...trace,
            span_name: `Trace ${sortedTraces.length - index}`, // Trace 1, Trace 2... or Trace N, Trace N-1? User said "Trace 1, Trace 2" and "last created to first created". Usually Trace 1 is the first one.
            // If we sort descending (newest first), the top one is the latest.
            // If I have 3 traces. T1, T2, T3 (created in order).
            // Sorted: T3, T2, T1.
            // UI:
            // - Trace 3 (most recent)
            // - Trace 2
            // - Trace 1
            // User image shows Trace 1 at top? No, user image shows Trace 1, Trace 2...
            // "we should show the traces by created at, we should show the last created to first created traces"
            // "Trace 1 trace 2 like that"
            // If "last created to first created" means Newest First.
            // If I name them Trace 1, Trace 2 based on index in sorted array:
            // Top (Newest) -> Trace 1.
            // Next (Older) -> Trace 2.
            // This seems consistent with "Trace 1, Trace 2" list item naming.

            // Wait, usually "Trace 1" implies the FIRST trace created.
            // If I show Newest First, "Trace 1" (created first) should be at the bottom?
            // "last created to first created traces" -> Newest top.
            // "show the Trace 1 trace 2 like that" -> Naming.
            // If I have 10 traces. T1...T10. T10 is newest.
            // Output:
            // T10 (Trace 10?)
            // ...
            // T1 (Trace 1?)

            // Let's stick to the image style. Image shows Trace 1, Trace 2, Trace 3...
            // If logic is Newest First:
            // Item 1 (Newest) -> Trace 1? Or Trace 10?
            // "Trace 1" usually means the first turn.
            // If I want to show "Turn 1, Turn 2", they should be ordered Time Ascending usually?
            // But user said "last created to first created".
            // So: T3 (Turn 3), T2 (Turn 2), T1 (Turn 1).
            // I will name them based on their original order (likely creation time).
            // The `sortedTraces` is Newest First.
            // The `trace.span_id` or original index can be used.
            // But `sessionTraces` comes from backend, hopefully sorted or I sort it.
            // If `sessionTraces` is not sorted, I should sort it first to determine the "Turn Number".

            // Let's assume sessionTraces comes in some order.
            // I'll sort descending for display.
            // For naming: I should probably use the index from the Original Ascending list (Chronological).
            // So if I have 3 traces. Newest is T3.
            // List:
            // - Trace 3
            // - Trace 2
            // - Trace 1

            // Implementation:
            // 1. Sort by time ASC to assign numbers.
            // 2. Reverse (or sort DESC) for display.

            span_name: `Trace ${sessionTraces.length - index}`, // If I iterate sorted (desc), index 0 is newest (Item N).
            // Wait, if I simply map:
            // sortedTraces[0] (Newest) -> Name "Trace N"
            // sortedTraces[last] (Oldest) -> Name "Trace 1"
            // Yes, `sessionTraces.length - index` works if sortedTraces is Descending.

            expanded: false, // Collapse trace children by default
        }))
    }, [sessionTraces])

    const treeRoot = useMemo(() => {
        if (!turnsTree || !turnsTree.length) return undefined

        let root = undefined

        if (!searchValue.trim()) {
            root = {
                span_id: "root",
                span_name: "Session",
                children: turnsTree,
                ...aggregatedStats,
                expanded: true, // Explicitly expand root
            } as any
            return root
        }

        root = {span_id: "root", span_name: "Session", children: turnsTree, expanded: true} as any
        const result = filterTree(root, searchValue)
        if (!result) return root
        return result
    }, [turnsTree, searchValue, aggregatedStats])

    const filteredTree = treeRoot

    const handleSelect = (key: string) => {
        setSelected(key)
        const element = document.getElementById(key)
        if (element) {
            element.scrollIntoView({behavior: "smooth", block: "start"})
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
