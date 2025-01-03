import {useMemo, useRef} from "react"
import clsx from "clsx"
import {Collapse} from "antd"
import PlaygroundVariantConfigPromptCollapseHeader from "./assets/PlaygroundVariantConfigPromptCollapseHeader"
import PlaygroundVariantConfigPromptCollapseContent from "./assets/PlaygroundVariantConfigPromptCollapseContent"
import {PlaygroundVariantConfigPromptComponentProps} from "./types"

/**
 * PlaygroundVariantConfigPrompt renders a collapsible configuration section for a single prompt.
 *
 * Features:
 * - Collapsible interface for prompt configuration
 * - Custom header with prompt information
 * - Configurable content section
 * - Maintains collapse state
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantConfigPrompt
 *   variantId="variant-123"
 *   promptIndex={0}
 * />
 * ```
 */
const PlaygroundVariantConfigPrompt: React.FC<PlaygroundVariantConfigPromptComponentProps> = ({
    variantId,
    promptIndex,
    className,
}) => {
    const defaultActiveKey = useRef(["1"])

    const items = useMemo(
        () => [
            {
                key: "1",
                classNames: {
                    body: "!border-t-0",
                    header: "[&.ant-collapse-header]:!px-2.5",
                },
                label: (
                    <PlaygroundVariantConfigPromptCollapseHeader
                        promptIndex={promptIndex}
                        variantId={variantId}
                    />
                ),
                children: (
                    <PlaygroundVariantConfigPromptCollapseContent
                        promptIndex={promptIndex}
                        variantId={variantId}
                    />
                ),
            },
        ],
        [promptIndex, variantId],
    )

    return (
        <Collapse
            ghost
            className={clsx(className)}
            bordered={false}
            defaultActiveKey={defaultActiveKey.current}
            items={items}
            // Add specific Collapse onChange handler if needed
            onChange={(keys) => {
                // Handle collapse state changes
            }}
        />
    )
}

export default PlaygroundVariantConfigPrompt
