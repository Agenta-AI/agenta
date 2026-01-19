/**
 * ToolMessageHeader Component
 *
 * Header component for tool response messages, showing the function name and call ID.
 * Built on top of the MetadataHeader presentational component.
 *
 * @deprecated For new code, consider using MetadataHeader directly:
 * import { MetadataHeader } from '@agenta/ui'
 */

import React from "react"

import {MetadataHeader} from "../../components/presentational/metadata"

interface ToolMessageHeaderProps {
    /** Function/tool name */
    name?: string
    /** Tool call ID this message responds to */
    toolCallId?: string
    /** Additional class name */
    className?: string
}

/**
 * Header component for tool response messages, showing the function name and call ID.
 * Similar to the playground's ToolCallViewHeader.
 */
export const ToolMessageHeader: React.FC<ToolMessageHeaderProps> = ({
    name,
    toolCallId,
    className,
}) => {
    return (
        <MetadataHeader
            label={name}
            labelTooltip="Function name"
            value={toolCallId}
            valueTooltip="Tool call ID"
            className={className}
        />
    )
}

export default ToolMessageHeader
