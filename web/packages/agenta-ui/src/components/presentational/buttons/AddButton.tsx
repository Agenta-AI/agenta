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

import {forwardRef, type ComponentPropsWithoutRef} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Plus} from "@phosphor-icons/react"
import clsx from "clsx"

// ============================================================================
// TYPES
// ============================================================================

export interface AddButtonProps extends ComponentPropsWithoutRef<typeof Button> {
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
                variant="outline"
                className={clsx(["self-start"], className)}
                {...props}
            >
                <Plus size={14} />
                {label}
            </Button>
        )
    },
)

export default AddButton
