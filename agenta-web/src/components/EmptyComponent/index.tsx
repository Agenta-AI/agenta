import {JSSTheme} from "@/lib/Types"
import {Button, Empty, Space, Tooltip, Typography} from "antd"
import React, {ReactNode} from "react"
import {createUseStyles} from "react-jss"

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

type Cta = {
    text: string
    onClick?: () => void
    icon?: ReactNode
    tooltip?: string
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
                            size="large"
                            icon={primaryCta.icon}
                            type="primary"
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
                                size="large"
                                icon={secondaryCta.icon}
                                type="default"
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
