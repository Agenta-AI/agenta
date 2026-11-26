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

import {useT} from "@agenta/i18n"
import uiChatCatalog from "@agenta/i18n/catalogs/ui.chat"

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
    const t = useT(uiChatCatalog)
    return (
        <MetadataHeader
            label={name}
            labelTooltip={t("ui.chat.functionName")}
            value={toolCallId}
            valueTooltip={t("ui.chat.toolCallId")}
            className={className}
        />
    )
}

export default ToolMessageHeader
