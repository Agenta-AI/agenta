import {Button, Typography} from "antd"
import clsx from "clsx"

import type {PlaygroundVariantModelConfigTitleProps} from "../types"

/**
 * PlaygroundVariantModelConfigTitle renders the title section of the model configuration modal.
 *
 * Features:
 * - Displays "Model Parameters" title
 * - Provides a reset button to restore default values
 * - Memoized to prevent unnecessary re-renders
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantModelConfigTitle
 *   handleReset={() => resetConfig()}
 *   className="custom-title"
 * />
 * ```
 */
const PlaygroundVariantModelConfigTitle: React.FC<PlaygroundVariantModelConfigTitleProps> = ({
    handleReset,
    className,
    disabled,
    ...props
}) => {
    return (
        <div
            className={clsx("flex items-center gap-6 justify-between", className)}
            onClick={(e) => e.stopPropagation()}
            {...props}
        >
            <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                Model Parameters
            </Typography.Text>
            <Button onClick={handleReset} disabled={disabled}>
                Reset default
            </Button>
        </div>
    )
}

export default PlaygroundVariantModelConfigTitle
