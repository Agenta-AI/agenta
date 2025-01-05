import {useMemo, useRef} from "react"

import clsx from "clsx"
import {Collapse} from "antd"

import PlaygroundVariantConfigPromptCollapseHeader from "./assets/PlaygroundVariantConfigPromptCollapseHeader"
import PlaygroundVariantConfigPromptCollapseContent from "./assets/PlaygroundVariantConfigPromptCollapseContent"
import { componentLogger } from "../../assets/utilities/componentLogger"

import type {PlaygroundVariantConfigPromptComponentProps} from "./types"

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
    promptId,
    className,
}) => {
    const defaultActiveKey = useRef(["1"])

    componentLogger("PlaygroundVariantConfigPrompt", variantId, promptId)

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
                        variantId={variantId}
                        promptId={promptId}
                    />
                ),
                children: (
                    <PlaygroundVariantConfigPromptCollapseContent
                        variantId={variantId}
                        promptId={promptId}
                    />
                ),
            },
        ],
        [variantId, promptId],
    )

    return (
        <Collapse
            className={clsx(
                "border-solid border-0 border-b border-[rgba(5,23,41,0.06)]",
                "rounded-none",
                className,
            )}
            bordered={false}
            defaultActiveKey={defaultActiveKey.current}
            items={items}
        />
    )
}

export default PlaygroundVariantConfigPrompt
