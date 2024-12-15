import {memo, useMemo, useRef} from "react"

import clsx from "clsx"
import {Collapse} from "antd"
import PlaygroundVariantConfigPromptCollapseHeader from "./assets/PlaygroundVariantConfigPromptCollapseHeader"
import PlaygroundVariantConfigPromptCollapseContent from "./assets/PlaygroundVariantConfigPromptCollapseContent"
import {PromptConfigType} from "../../hooks/useAgentaConfig/types"

const PlaygroundVariantConfigPromptCollapse = ({
    variantId,
    prompt,
}: {
    variantId: string
    prompt: PromptConfigType
}) => {
    const defaultActiveKey = useRef(["1"])
    console.log("render PlaygroundVariantConfigCollapse")
    const items = useMemo(() => {
        return [
            {
                key: "1",
                classNames: {
                    body: "!border-t-0",
                    header: "[&.ant-collapse-header]:!px-2.5",
                },
                label: (
                    <PlaygroundVariantConfigPromptCollapseHeader
                        prompt={prompt}
                        variantId={variantId}
                    />
                ),
                children: (
                    <PlaygroundVariantConfigPromptCollapseContent
                        prompt={prompt}
                        variantId={variantId}
                    />
                ),
            },
        ]
    }, [variantId, prompt])
    return (
        <Collapse
            className={clsx([
                "border-solid border-0 border-b border-[rgba(5,23,41,0.06)]",
                "rounded-none",
            ])}
            bordered={false}
            defaultActiveKey={defaultActiveKey.current}
            items={items}
        />
    )
}

export default memo(PlaygroundVariantConfigPromptCollapse)
