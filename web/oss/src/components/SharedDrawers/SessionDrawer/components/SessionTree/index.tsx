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
    const {sessionTraces} = useSessionDrawer()

    const turnsTree: TraceSpanNode[] = useMemo(() => {
        return sessionTraces || []
    }, [sessionTraces])

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
                onSelect={setSelected}
            />
        </div>
    )
}

export default SessionTree
