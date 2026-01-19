/**
 * PathSelector Component
 *
 * Reusable dropdown for selecting source paths (output or testcase).
 */

import type {PathInfo} from "@agenta/entities/runnable"
import {Lightning, Table} from "@phosphor-icons/react"
import {Select, Typography} from "antd"

const {Text} = Typography

export interface PathSelectorProps {
    value: string | undefined
    onChange: (value: string) => void
    availablePaths: PathInfo[]
    placeholder?: string
    allowClear?: boolean
    size?: "small" | "middle" | "large"
    className?: string
}

/**
 * Dropdown selector for source paths with type indicators
 */
export function PathSelector({
    value,
    onChange,
    availablePaths,
    placeholder = "Select source...",
    allowClear = false,
    size = "small",
    className = "w-full",
}: PathSelectorProps) {
    return (
        <Select
            value={value || undefined}
            onChange={onChange}
            placeholder={placeholder}
            className={className}
            size={size}
            allowClear={allowClear}
            showSearch
            optionFilterProp="label"
            options={availablePaths.map((p) => ({
                value: p.pathString || p.path,
                label: (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                            {p.source === "testcase" ? (
                                <Table size={12} className="text-green-600 flex-shrink-0" />
                            ) : (
                                <Lightning size={12} className="text-blue-500 flex-shrink-0" />
                            )}
                            <span className="truncate">{p.label}</span>
                        </div>
                        <Text type="secondary" className="text-xs ml-2">
                            {p.valueType || p.type}
                        </Text>
                    </div>
                ),
            }))}
        />
    )
}
