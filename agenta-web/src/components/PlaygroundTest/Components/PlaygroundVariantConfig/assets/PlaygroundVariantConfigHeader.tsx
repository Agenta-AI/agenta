import {useCallback} from "react"

import clsx from "clsx"
import {Tag, Button} from "antd"

import usePlayground from "../../../hooks/usePlayground"
import VariantsButton from "../../VariantsButton"

import type {VariantConfigComponentProps, VariantActionButtonProps} from "../types"
import type {EnhancedVariant} from "../../../assets/utilities/transformer/types"

/**
 * Button to save variant changes when modifications are detected
 */
const PlaygroundVariantSaveButton: React.FC<VariantActionButtonProps> = ({variantId}) => {
    const {saveVariant, isDirty} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantSaveButton",
    })

    return isDirty ? (
        <Button type="primary" size="small" onClick={saveVariant}>
            Save
        </Button>
    ) : null
}

/**
 * Button to delete variant if it's not the last variant of an app
 */
const PlaygroundVariantDeleteButton: React.FC<VariantActionButtonProps> = ({variantId}) => {
    const {variantIds, deleteVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantDeleteButton",
    })

    return !!variantIds && variantIds.length > 1 ? (
        <Button type="default" color="primary" size="small" onClick={deleteVariant}>
            Delete
        </Button>
    ) : null
}

/**
 * PlaygroundVariantConfigHeader displays the variant name, revision,
 * and action buttons for saving/deleting the variant.
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantConfigHeader variantId="variant-123" />
 * ```
 */
const PlaygroundVariantConfigHeader: React.FC<VariantConfigComponentProps> = ({
    variantId,
    className,
    ...divProps
}) => {
    const {revision} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantConfigHeader",
        variantSelector: useCallback(
            (variant: EnhancedVariant) => ({
                variantName: variant?.variantName,
                revision: variant?.revision,
            }),
            [],
        ),
    })

    return (
        <div
            className={clsx(
                "w-full h-[48px] px-2.5",
                "flex items-center justify-between",
                "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                "sticky top-0 z-[1]",
                "bg-white",
                className,
            )}
            {...divProps}
        >
            <div className="flex items-center gap-2">
                <VariantsButton selectedVariant={variantId} />
                <Tag color="default" bordered={false} className="bg-[rgba(5,23,41,0.06)]">
                    {`v${revision}`}
                </Tag>
            </div>
            <div className="flex items-center gap-2">
                <PlaygroundVariantSaveButton variantId={variantId} />
                <PlaygroundVariantDeleteButton variantId={variantId} />
            </div>
        </div>
    )
}

export default PlaygroundVariantConfigHeader
