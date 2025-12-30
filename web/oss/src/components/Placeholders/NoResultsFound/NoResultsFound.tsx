import {ReactNode} from "react"

import {Button, Typography} from "antd"
import Image from "next/image"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

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

const NoResultsFound = ({
    className,
    title,
    description,
    primaryActionLabel = "Create your first evaluator",
    onPrimaryAction,
    primaryActionSlot,
}: {
    className?: string
    title?: string
    description?: string
    primaryActionLabel?: string
    onPrimaryAction?: () => void
    /** Custom slot to render instead of the default primary action button */
    primaryActionSlot?: ReactNode
}) => {
    const classes = useStyles()
    return (
        <div className={`${classes.notFound} ${className}`}>
            <Image src="/assets/not-found.png" alt="not-found" width={240} height={210} />
            <Typography.Text>{!title ? "No Results found" : title}</Typography.Text>
            <Typography.Paragraph type="secondary">
                {!description ? "No results match the search criteria." : description}
            </Typography.Paragraph>
            {primaryActionSlot
                ? primaryActionSlot
                : onPrimaryAction && (
                      <Button type="primary" onClick={onPrimaryAction}>
                          {primaryActionLabel}
                      </Button>
                  )}
        </div>
    )
}

export default NoResultsFound
