import {Typography} from "antd"

import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"

import useSessionDrawer from "../../hooks/useSessionDrawer"

const SessionContentSummary = () => {
    const {activeSession} = useSessionDrawer()

    const formatSummaryValue = (key: string, value: number) => {
        if (typeof value !== "number") return value

        if (key === "latency" || key === "duration") {
            return formatLatency(value / 1000)
        }

        if (key === "tokens") {
            return formatTokenUsage(value)
        }

        if (key === "cost") {
            return formatCurrency(value)
        }

        return value
    }

    return (
        <div className="flex flex-col gap-2">
            <Typography.Text>Summary</Typography.Text>
            <div className="flex items-center gap-2">
                {Object.entries(activeSession?.summary || {}).map(([key, value]) => {
                    return (
                        <div
                            key={key}
                            className="flex border border-solid border-colorSplit rounded-md overflow-hidden"
                        >
                            <div className="px-2 py-0.5 border-0 border-r border-solid border-colorSplit bg-gray-50 capitalize">
                                {key}
                            </div>
                            <div className="px-2 py-0.5 bg-white">
                                {formatSummaryValue(key, value)}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export default SessionContentSummary
