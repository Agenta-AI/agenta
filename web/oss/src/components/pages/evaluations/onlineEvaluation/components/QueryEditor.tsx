import {DatePicker, Form, Switch, Tooltip, Typography} from "antd"
import dynamic from "next/dynamic"

import getFilterColumns from "@/oss/components/pages/observability/assets/getFilterColumns"
import type {Filter} from "@/oss/lib/Types"

import SamplingRateControl from "./SamplingRateControl"

const Filters = dynamic(() => import("@/oss/components/Filters/Filters"), {ssr: false})
const {Text} = Typography
const {RangePicker} = DatePicker

export interface QueryEditorProps {
    /** Current trace filter conditions. */
    filters: Filter[]
    /** Called when the user applies or clears filters. */
    onFiltersChange: (filters: Filter[]) => void
    /** Field menu for the filter builder (from `getFilterColumns`). */
    filterColumns: ReturnType<typeof getFilterColumns>
    /**
     * Render the filter editor inline (always-visible rows) instead of behind the
     * funnel button. Used by the Query Registry drawer where editing the filter is
     * the primary task; the live-eval drawer keeps the compact button.
     */
    inlineFilters?: boolean
}

/**
 * Reusable query editor: trace filter + sampling rate + (coming-soon) historical
 * window. Renders inside an antd Form context — `sampling_rate`, `historical`,
 * and `historical_range` are form fields, so the parent form collects them
 * unchanged. Shared by the live-eval Online Evaluation drawer and the Query
 * Registry manage drawer.
 */
const QueryEditor = ({
    filters,
    onFiltersChange,
    filterColumns,
    inlineFilters = false,
}: QueryEditorProps) => {
    return (
        <>
            <div
                className={
                    inlineFilters
                        ? "grid grid-cols-1 gap-3"
                        : "grid grid-cols-1 gap-3 md:grid-cols-2"
                }
            >
                <Form.Item
                    label={inlineFilters ? "Filter" : "Run for filters"}
                    style={{marginBottom: 0}}
                >
                    <Filters
                        inline={inlineFilters}
                        filterData={filters}
                        columns={filterColumns}
                        onApplyFilter={(newFilters: Filter[]) => onFiltersChange(newFilters)}
                        onClearFilter={(newFilters: Filter[]) => onFiltersChange(newFilters)}
                        buttonProps={{
                            size: "middle",
                            className: "!flex !items-center !gap-2",
                        }}
                    />
                </Form.Item>
                <Form.Item name="sampling_rate" label="Sampling rate" style={{marginBottom: 0}}>
                    <SamplingRateControl />
                </Form.Item>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <Form.Item name="historical" valuePropName="checked" className="mb-0">
                        <Switch size="small" disabled />
                    </Form.Item>
                    <Tooltip title="Not available yet">
                        <Text type="secondary">Run on historical data</Text>
                    </Tooltip>
                </div>
                <Form.Item name="historical_range" className="mb-0">
                    <RangePicker
                        allowClear
                        allowEmpty
                        disabled
                        className="w-[200px]"
                        placeholder={["Start date", "End date"]}
                    />
                </Form.Item>
            </div>
        </>
    )
}

export default QueryEditor
