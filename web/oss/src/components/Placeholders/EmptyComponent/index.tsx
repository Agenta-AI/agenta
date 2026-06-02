import {ReactNode} from "react"

import {Button, Empty, Space, Tooltip, Typography} from "antd"
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
                    <Tooltip title={primaryCta.tooltip}>
                        <Button
                            size={primaryCta.size || "large"}
                            icon={primaryCta.icon}
                            type={primaryCta.type || "primary"}
                            onClick={primaryCta.onClick}
                        >
                            {primaryCta.text}
                        </Button>
                    </Tooltip>
                )}
                {secondaryCta && (
                    <>
                        <Typography.Text>Or</Typography.Text>
                        <Tooltip title={secondaryCta.tooltip} placement="bottom">
                            <Button
                                size={secondaryCta.size || "large"}
                                icon={secondaryCta.icon}
                                type={secondaryCta.type || "default"}
                                onClick={secondaryCta.onClick}
                            >
                                {secondaryCta.text}
                            </Button>
                        </Tooltip>
                    </>
                )}
            </Space>
        </Empty>
    )
}

export default EmptyComponent
