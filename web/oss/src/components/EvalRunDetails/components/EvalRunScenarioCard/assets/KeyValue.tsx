import {memo} from "react"

import {Typography} from "antd"

import {KeyValueProps} from "../types"

const KeyValue = ({label, value, ...rest}: KeyValueProps) => {
    const renderVal = () => {
        if (value == null || value === "") {
            return <span className="text-gray-400 italic">N/A</span>
        }
        if (typeof value === "object") {
            const entries = Object.entries(value as Record<string, any>)
            if (entries.length > 1) {
                return (
                    <ul className="list-none m-0 p-0">
                        {entries.map(([k, v]) => {
                            if (process.env.NODE_ENV !== "production") {
                                console.debug("k - v", k, v)
                            }
                            return (
                                <li key={k} className="pl-0 flex items-center">
                                    <Typography.Text strong className="!text-sm mr-2">
                                        {k}:
                                    </Typography.Text>
                                    <Typography.Text className="!text-sm">
                                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                    </Typography.Text>
                                </li>
                            )
                        })}
                    </ul>
                )
            }
            const singleVal = entries[0][1]
            return typeof singleVal === "object" ? JSON.stringify(singleVal) : String(singleVal)
        }
        return String(value)
    }

    return (
        <>
            <div className="flex w-full items-start">
                <Typography.Text
                    strong
                    className="min-w-[110px] text-right pr-2 !text-sm"
                    {...rest}
                >
                    {label}:
                </Typography.Text>
                <Typography.Text className="flex-1 break-all !text-sm">
                    {renderVal()}
                </Typography.Text>
            </div>
        </>
    )
}

export default memo(KeyValue)
