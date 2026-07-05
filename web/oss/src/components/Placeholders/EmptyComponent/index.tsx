import {ReactNode} from "react"

import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {Button, Empty, Space} from "antd"
import {BaseButtonProps} from "antd/es/button/button"

const emptyClass =
    "[&_.ant-empty-description]:text-base [&_.ant-empty-description]:mb-6 [&_.ant-empty-description]:text-colorTextSecondary [&_.ant-empty-image]:h-auto [&_.ant-empty-image]:mb-6 [&_.ant-empty-image]:text-colorTextSecondary [&_.ant-empty-image_img]:dark:invert"

interface Cta {
    text: string
    onClick?: () => void
    icon?: ReactNode
    tooltip?: string
    type?: BaseButtonProps["type"]
    size?: BaseButtonProps["size"]
}

interface Props {
    image?: ReactNode
    description?: ReactNode
    primaryCta?: Cta
    secondaryCta?: Cta
}

const EmptyComponent: React.FC<Props> = ({image, description, primaryCta, secondaryCta}) => {
    return (
        <Empty className={emptyClass} description={description} image={image}>
            <Space orientation="vertical">
                {primaryCta && (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    size={primaryCta.size || "large"}
                                    icon={primaryCta.icon}
                                    type={primaryCta.type || "primary"}
                                    onClick={primaryCta.onClick}
                                >
                                    {primaryCta.text}
                                </Button>
                            }
                        />
                        <TooltipContent>{primaryCta.tooltip}</TooltipContent>
                    </Tooltip>
                )}
                {secondaryCta && (
                    <>
                        <span>Or</span>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        size={secondaryCta.size || "large"}
                                        icon={secondaryCta.icon}
                                        type={secondaryCta.type || "default"}
                                        onClick={secondaryCta.onClick}
                                    >
                                        {secondaryCta.text}
                                    </Button>
                                }
                            />
                            <TooltipContent side="bottom">{secondaryCta.tooltip}</TooltipContent>
                        </Tooltip>
                    </>
                )}
            </Space>
        </Empty>
    )
}

export default EmptyComponent
