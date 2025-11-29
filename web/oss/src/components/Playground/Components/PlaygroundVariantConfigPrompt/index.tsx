import {useMemo, useRef} from "react"

import {Collapse} from "antd"
import clsx from "clsx"

import PlaygroundVariantConfigPromptCollapseContent from "./assets/PlaygroundVariantConfigPromptCollapseContent"
import PlaygroundVariantConfigPromptCollapseHeader from "./assets/PlaygroundVariantConfigPromptCollapseHeader"
import {useStyles} from "./styles"
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
    viewOnly = false,
    enableTourTarget = false,
    ...props
}) => {
    const defaultActiveKey = useRef(["1"])
    const classes = useStyles()
    const promptSectionId = enableTourTarget ? "tour-playground-prompt" : undefined

    const items = useMemo(
        () => [
            {
                key: "1",
                classNames: {
                    body: "!border-t-0 !pt-0",
                    header: "z-10",
                },
                label: (
                    <div className="px-2.5 !p-0 my-0">
                        <PlaygroundVariantConfigPromptCollapseHeader
                            variantId={variantId}
                            promptId={promptId}
                            viewOnly={viewOnly}
                        />
                    </div>
                ),
                children: (
                    <PlaygroundVariantConfigPromptCollapseContent
                        variantId={variantId}
                        promptId={promptId}
                        viewOnly={viewOnly}
                        id={promptSectionId}
                    />
                ),
            },
        ],
        [variantId, promptId, viewOnly, promptSectionId],
    )

    return (
        <Collapse
            ghost
            className={clsx("rounded-none", className, classes.collapseContainer)}
            bordered={false}
            defaultActiveKey={defaultActiveKey.current}
            items={items}
            {...props}
        />
    )
}

export default PlaygroundVariantConfigPrompt
