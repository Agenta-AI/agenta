import {ReactNode} from "react"

import {Button, Empty, Space, Tooltip, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"
import {BaseButtonProps} from "antd/es/button/button"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    empty: {
        "& .ant-empty-description": {
            fontSize: 16,
            marginBottom: "1.5rem",
            color: theme.colorTextSecondary,
        },
        "& .ant-empty-image": {
            "& img": {
                filter: theme.isDark ? "invert(1)" : "none",
            },
            height: "auto",
            marginBottom: "1.5rem",
            color: theme.colorTextSecondary,
        },
    },
}))

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
    const classes = useStyles()

    return (
        <Empty className={classes.empty} description={description} image={image}>
            <Space direction="vertical">
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
