import {memo, useMemo, useRef} from "react"

import clsx from "clsx"
import {Collapse} from "antd"
import PlaygroundVariantConfigPromptCollapseHeader from "./assets/PlaygroundVariantConfigPromptCollapseHeader"
import PlaygroundVariantConfigPromptCollapseContent from "./assets/PlaygroundVariantConfigPromptCollapseContent"

const PlaygroundVariantConfigPrompt = ({
    variantId,
    promptIndex,
}: {
    promptIndex: number
    variantId: string
}) => {
    console.log("render PlaygroundVariantConfigCollapse")
    const defaultActiveKey = useRef(["1"])
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
        ]
    }, [promptIndex, variantId])
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

export default memo(PlaygroundVariantConfigPrompt)
