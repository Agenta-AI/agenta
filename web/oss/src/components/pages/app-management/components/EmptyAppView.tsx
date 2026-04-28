import {Typography} from "antd"
import Image from "next/image"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

import CreateAppDropdown from "./CreateAppDropdown"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: theme.padding,
        borderRadius: theme.borderRadius,
        border: `1px solid ${theme.colorBorderSecondary}`,
        "& > div": {
            padding: "40px 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            "& span.ant-typography": {
                fontSize: theme.fontSizeHeading4,
                lineHeight: theme.lineHeightHeading4,
                fontWeight: theme.fontWeightMedium,
            },
        },
    },
}))

const EmptyAppView = () => {
    const classes = useStyles()
    return (
        <div className={classes.container}>
            <div>
                <Image src="/assets/not-found.png" alt="not-found" width={240} height={210} />
                <Typography.Text>Click here to create your first prompt</Typography.Text>
                <CreateAppDropdown />
            </div>
        </div>
    )
}

export default EmptyAppView
