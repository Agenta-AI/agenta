/**
 * AddButton Component
 *
 * A generic "Add" button with a Plus icon. Wraps Ant Design Button
 * with consistent styling for add/create actions.
 *
 * @example
 * ```tsx
 * import { AddButton } from '@agenta/ui'
 *
 * <AddButton label="Add Item" onClick={handleAdd} />
 * <AddButton label="Message" size="small" />
 * ```
 */

import {forwardRef} from "react"

import {Plus} from "@phosphor-icons/react"
import {Button, type ButtonProps} from "antd"
import clsx from "clsx"

// ============================================================================
// TYPES
// ============================================================================

export interface AddButtonProps extends ButtonProps {
    label?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

const AddButton = forwardRef<HTMLButtonElement, AddButtonProps>(
    ({label, className, ...props}: AddButtonProps, ref) => {
        return (
            <Button
                ref={ref}
                variant="outlined"
                color="default"
                icon={<Plus size={14} />}
                className={clsx(["self-start"], className)}
                {...props}
            >
                {label}
            </Button>
        )
    },
)

export default AddButton
