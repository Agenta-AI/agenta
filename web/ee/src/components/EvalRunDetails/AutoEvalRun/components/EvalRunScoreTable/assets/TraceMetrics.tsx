import {memo} from "react"
import {Space, Tooltip} from "antd"

import {Timer, Coins, PlusCircle} from "@phosphor-icons/react"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"

const TraceMetrics = ({latency, cost, tokens}: {latency: number; cost: number; tokens: number}) => {
    return (
        <div className="flex items-center gap-2">
            <Space className="text-[#586673]">
                <Tooltip
                    title={`Latency: ${formatLatency(latency)}`}
                    mouseEnterDelay={0.25}
                    placement="bottom"
                >
                    <div className="flex items-center gap-2 font-mono cursor-default hover:scale-[1.05] duration-200">
                        <Timer />
                        {formatLatency(latency)}
                    </div>
                </Tooltip>

                <Tooltip
                    title={`Cost: ${formatCurrency(cost)}`}
                    mouseEnterDelay={0.25}
                    placement="bottom"
                >
                    <div className="flex items-center gap-2 font-mono cursor-default hover:scale-[1.05] duration-200">
                        <Coins />
                        {formatCurrency(cost)}
                    </div>
                </Tooltip>

                <Tooltip
                    title={`Tokens: ${formatTokenUsage(tokens)}`}
                    mouseEnterDelay={0.25}
                    placement="bottom"
                >
                    <div className="flex items-center gap-2 font-mono cursor-default hover:scale-[1.05] duration-200">
                        <PlusCircle />
                        {formatTokenUsage(tokens)}
                    </div>
                </Tooltip>
            </Space>
        </div>
    )
}

export default memo(TraceMetrics)
