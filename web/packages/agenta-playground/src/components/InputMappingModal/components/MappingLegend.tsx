/**
 * MappingLegend Component
 *
 * Legend showing source types and mapping status indicators.
 */

import {Lightning, MagicWand, Table, Warning} from "@phosphor-icons/react"
import {Tag, Typography} from "antd"

const {Text} = Typography

export interface MappingLegendProps {
    sourceLabel: string
    testcaseCount: number
    outputCount: number
}

/**
 * Legend showing available sources and mapping status types
 */
export function MappingLegend({sourceLabel, testcaseCount, outputCount}: MappingLegendProps) {
    return (
        <>
            {/* Available Paths Info */}
            {(outputCount > 0 || testcaseCount > 0) && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <Text type="secondary" className="text-xs">
                        <strong>Available sources:</strong>{" "}
                        {outputCount > 0 && (
                            <span className="inline-flex items-center gap-1 mr-2">
                                <Lightning size={10} className="text-blue-500" />
                                {outputCount} from {sourceLabel}
                            </span>
                        )}
                        {testcaseCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                                <Table size={10} className="text-green-600" />
                                {testcaseCount} from testcase
                            </span>
                        )}
                    </Text>
                </div>
            )}

            {/* Legend */}
            <div className="mt-4 flex flex-wrap items-center gap-4">
                {/* Source type indicators */}
                <div className="flex items-center gap-1">
                    <Lightning size={12} className="text-blue-500" />
                    <Text type="secondary" className="text-xs">
                        Output
                    </Text>
                </div>
                <div className="flex items-center gap-1">
                    <Table size={12} className="text-green-600" />
                    <Text type="secondary" className="text-xs">
                        Testcase
                    </Text>
                </div>
                <div className="border-l border-gray-300 h-4" />
                {/* Mapping status indicators */}
                <div className="flex items-center gap-1">
                    <Tag color="blue" className="m-0">
                        <MagicWand size={10} className="mr-1" />
                        Auto
                    </Tag>
                    <Text type="secondary" className="text-xs">
                        Auto-mapped
                    </Text>
                </div>
                <div className="flex items-center gap-1">
                    <Tag color="green" className="m-0">
                        Manual
                    </Tag>
                    <Text type="secondary" className="text-xs">
                        Manually set
                    </Text>
                </div>
                <div className="flex items-center gap-1">
                    <Tag color="red" className="m-0">
                        <Warning size={10} className="mr-1" />
                        Missing
                    </Tag>
                    <Text type="secondary" className="text-xs">
                        Needs mapping
                    </Text>
                </div>
            </div>
        </>
    )
}
