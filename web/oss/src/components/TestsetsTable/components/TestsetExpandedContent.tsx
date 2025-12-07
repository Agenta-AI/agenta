import {LoadingOutlined} from "@ant-design/icons"
import {GitBranch} from "@phosphor-icons/react"

import {UserReference} from "@/oss/components/References"
import {formatDate} from "@/oss/lib/helpers/dateTimeHelper"

import type {TestsetVariant} from "../atoms/fetchTestsetVariants"
import type {TestsetTableRow} from "../atoms/tableStore"

interface TestsetExpandedContentProps {
    record: TestsetTableRow
    variants: TestsetVariant[]
    loading: boolean
    error: Error | null
}

// Column widths matching the parent table
// checkbox: 48px, Name: 300px, Date Created: flex, Created by: flex, Actions: 50px
const CHECKBOX_WIDTH = 48
const NAME_WIDTH = 300
const ACTIONS_WIDTH = 50

/**
 * Renders the expanded content for a testset row showing its variants.
 * Uses CSS to align with parent table columns.
 */
const TestsetExpandedContent = ({
    record: _record,
    variants,
    loading,
    error,
}: TestsetExpandedContentProps) => {
    if (loading) {
        return (
            <div className="flex items-center py-3 pl-[100px] text-gray-400">
                <LoadingOutlined className="mr-2" />
                <span className="text-sm">Loading variants...</span>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center py-3 pl-[100px] text-red-500">
                <span className="text-sm">Failed to load variants: {error.message}</span>
            </div>
        )
    }

    if (variants.length === 0) {
        return (
            <div className="flex items-center py-3 pl-[100px] text-gray-400">
                <span className="text-sm">No variants found</span>
            </div>
        )
    }

    // Render variants as rows with cells matching parent column widths
    // The expanded row td has padding, so we use negative margin to align with parent
    return (
        <div className="w-full -mx-4">
            {variants.map((variant) => (
                <div
                    key={variant.id}
                    className="flex items-center hover:bg-gray-50 transition-colors border-b border-gray-100"
                    style={{minHeight: 55}}
                >
                    {/* Checkbox column spacer - matches parent's 48px checkbox column */}
                    <div className="flex-shrink-0" style={{width: CHECKBOX_WIDTH}} />
                    {/* Name column - 300px with left padding for indent */}
                    <div
                        className="flex-shrink-0 flex items-center gap-2 py-4"
                        style={{width: NAME_WIDTH, paddingLeft: 40}}
                    >
                        <GitBranch size={14} className="text-gray-400 flex-shrink-0" />
                        <span>{variant.name || "default"}</span>
                    </div>
                    {/* Date Created column - flex to match parent */}
                    <div className="flex-1 py-4 px-4">{formatDate(variant.created_at)}</div>
                    {/* Created by column - flex to match parent */}
                    <div className="flex-1 py-4 px-4">
                        {variant.created_by_id ? (
                            <UserReference userId={variant.created_by_id} />
                        ) : (
                            "-"
                        )}
                    </div>
                    {/* Actions column spacer */}
                    <div className="flex-shrink-0" style={{width: ACTIONS_WIDTH}} />
                </div>
            ))}
        </div>
    )
}

export default TestsetExpandedContent
