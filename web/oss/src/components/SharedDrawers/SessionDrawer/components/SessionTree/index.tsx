import {useMemo, useState} from "react"

import {MagnifyingGlass, SlidersHorizontal} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover} from "antd"
import clsx from "clsx"
import {useLocalStorage} from "usehooks-ts"

import CustomTreeComponent from "@/oss/components/CustomUIs/CustomTreeComponent"
import {StatusCode, TraceSpanNode} from "@/oss/services/tracing/types"

import {filterTree} from "@/oss/components/pages/observability/assets/utils"
import {useSessionDrawer} from "../../hooks/useSessionDrawer"

import TraceTreeSettings from "../../../TraceDrawer/components/TraceTreeSettings"
import {SessionTreeProps} from "./assets/types"

const SessionTree = ({selected, setSelected}: SessionTreeProps) => {
    const [searchValue, setSearchValue] = useState("")

    const [traceTreeSettings, setTraceTreeSettings] = useLocalStorage("traceTreeSettings", {
        latency: true,
        cost: true,
        tokens: true,
    })
    const {activeSession} = useSessionDrawer()

    const buildNodeFromTrace = (node: any): TraceSpanNode => {
        const spanId = node?.span_id || node?.trace_id || node?.id || node?.node?.id
        const name = node?.span_name || node?.node?.name || node?.name || "span"
        const status =
            node?.status_code || node?.status || node?.status?.code || StatusCode.STATUS_CODE_UNSET

        const children = Array.isArray(node?.children)
            ? node.children.map((child: any) => buildNodeFromTrace(child))
            : []

        return {
            span_id: spanId,
            span_name: name,
            status_code: status,
            children,
            metrics: node?.metrics,
            attributes: node?.attributes,
        } as TraceSpanNode
    }

    const turnsTree = useMemo(() => {
        if (!activeSession) return undefined

        return activeSession.turns.map((turn) => {
            const spanId = `turn-${turn.turn_index}`
            const status =
                turn.status === "error" ? StatusCode.STATUS_CODE_ERROR : StatusCode.STATUS_CODE_OK

            const children =
                Array.isArray(turn.trace?.children) && turn.trace?.children.length
                    ? turn.trace.children.map((child: any) => buildNodeFromTrace(child))
                    : []

            return {
                span_id: spanId,
                span_name: `Turn ${turn.turn_index}: ${turn.assistant_message?.content?.slice(0, 48) || "response"}`,
                status_code: status,
                metrics: {
                    latency_ms: turn.latency_ms,
                    cost_usd: turn.cost_usd,
                    tokens: turn.usage?.total_tokens,
                },
                children,
            } as TraceSpanNode
        }) as TraceSpanNode[]
    }, [activeSession])

    const treeRoot = useMemo(() => {
        if (!turnsTree || !turnsTree.length) return undefined
        if (!searchValue.trim()) return turnsTree[0] as any
        const root = {span_id: "root", span_name: "Session", children: turnsTree} as any
        const result = filterTree(root, searchValue)
        if (!result) return root
        return result
    }, [turnsTree, searchValue])

    const filteredTree = treeRoot

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
                    classNames={{body: "!p-0 w-[180px]"}}
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
                onSelect={setSelected}
            />
        </div>
    )
}

export default SessionTree
