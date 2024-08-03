import {JSSTheme} from "@/lib/Types"
import {Rocket} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"
import React from "react"
import {createUseStyles} from "react-jss"

const {Title, Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > div h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
    titleLink: {
        display: "flex",
        alignItems: "center",
        gap: theme.paddingSM,
        border: `1px solid ${theme.colorBorder}`,
        padding: "5px 15px",
        height: 32,
        borderRadius: theme.borderRadius,
        color: theme.colorText,
        "&:hover": {
            borderColor: theme.colorInfoBorderHover,
            transition: "all 0.2s cubic-bezier(0.645, 0.045, 0.355, 1)",
        },
    },
}))
const VariantsOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    return (
        <div className={classes.container}>
            <div className="flex items-center justify-between">
                <Title>Variants</Title>

                <Link href={`/apps/${appId}/playground`} className={classes.titleLink}>
                    <Rocket size={16} />
                    Playground
                </Link>
            </div>

            <div>hello</div>
        </div>
    )
}

export default VariantsOverview
