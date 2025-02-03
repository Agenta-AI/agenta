import {memo} from "react"
import {Switch, Tooltip, Typography} from "antd"
import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControlWrapper"
import {BooleanControlProps} from "./types"

/**
 * A boolean toggle control component for playground variant properties.
 *
 * @remarks
 * - Renders as a horizontal layout with label and switch
 * - Directly propagates state changes without debouncing
 * - Used for simple true/false configuration options
 */
const BooleanControl = ({
    withTooltip,
    description,
    label,
    value,
    disabled,
    onChange,
}: BooleanControlProps) => {
    return (
        <PlaygroundVariantPropertyControlWrapper className="!flex-row justify-between">
            {withTooltip ? (
                <Tooltip title={description}>
                    <Typography.Text>{label}</Typography.Text>
                </Tooltip>
            ) : (
                <Typography.Text>{label}</Typography.Text>
            )}
            <Switch disabled={disabled} checked={value} onChange={onChange} />
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(BooleanControl)
