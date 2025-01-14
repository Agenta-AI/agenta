import {memo} from "react"
import {Switch, Typography} from "antd"
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
const BooleanControl = ({label, value, onChange}: BooleanControlProps) => {
    return (
        <PlaygroundVariantPropertyControlWrapper className="!flex-row justify-between">
            <Typography.Text>{label}</Typography.Text>
            <Switch checked={value} onChange={onChange} />
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(BooleanControl)
