import React from "react"
import {Typography} from "antd"
import Image from "next/image"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    notFound: {
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 0px",
        gap: 16,
        "& > span.ant-typography": {
            lineHeight: theme.lineHeightHeading4,
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightMedium,
            color: theme.colorText,
        },
    },
}))

const NoResultsFound = ({className}: {className?: string}) => {
    const classes = useStyles()
    return (
        <div className={`${classes.notFound} ${className}`}>
            <Image src="/assets/not-found.png" alt="not-found" width={240} height={210} />
            <Typography.Text>No Results found</Typography.Text>
            <Typography.Paragraph type="secondary">
                No results match the search criteria.
            </Typography.Paragraph>
        </div>
    )
}

export default NoResultsFound
