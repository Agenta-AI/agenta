import {JSSTheme} from "@/lib/Types"
import {ArrowRight, BookOpen, Code, HandWaving} from "@phosphor-icons/react"
import {Space, Typography} from "antd"
import Link from "next/link"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    helperCard: {
        maxWidth: 400,
        flex: 1,
        gap: 12,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        transition: "all 0.025s ease-in",
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadius,
        padding: theme.paddingSM,
        "& span.ant-typography": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: theme.fontSizeLG,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightLG,
            flex: 1,
        },
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
        },
    },
}))

const {Text, Title} = Typography

const HelpAndSupportSection = () => {
    const classes = useStyles()

    return (
        <div className="mt-10 mb-20 flex flex-col gap-4">
            <Space direction="vertical" size={8}>
                <Title level={2}>Have a question?</Title>
                <Text>Checkout our docs or send us a message on slack.</Text>
            </Space>

            <div className="flex items-center w-full gap-4">
                <Link className={classes.helperCard} href="https://docs.agenta.ai/" target="_blank">
                    <BookOpen size={24} />
                    <Text>Check out docs</Text>
                    <ArrowRight size={18} />
                </Link>
                <Link
                    href="https://github.com/Agenta-AI/agenta/discussions"
                    target="_blank"
                    className={classes.helperCard}
                >
                    <Code size={24} />
                    <Text>Create a discussion in Github</Text>
                    <ArrowRight size={18} />
                </Link>
                <Link
                    href="https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA"
                    target="_blank"
                    className={classes.helperCard}
                >
                    <HandWaving size={24} />
                    <Text>Say hello at Slack</Text>
                    <ArrowRight size={18} />
                </Link>
            </div>
        </div>
    )
}

export default HelpAndSupportSection
