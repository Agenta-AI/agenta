import {JSSTheme} from "@/lib/Types"
import {Popover, Tag} from "antd"
import React, {memo} from "react"
import {createUseStyles} from "react-jss"

type ResultTagProps = {
    popoverContent?: React.ReactNode
    value1: string | React.ReactNode
    value2?: React.ReactNode
} & React.ComponentProps<typeof Tag>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    resultTag: {
        display: "flex",
        alignItems: "center",
        width: "fit-content",
        padding: 0,
        cursor: "pointer",
        "& > span.value1": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
            flex: 1,
            padding: "0px 8px",
            borderRight: `1px solid ${theme.colorBorder}`,
        },
        "& > span.value2": {
            background: theme.colorBgContainer,
            padding: "0px 8px 0px 4px",
            borderRadius: "inherit",
        },
        "& > div.singleValue": {
            padding: "0px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
        },
    },
}))

const ResultTag = memo(({value1, value2, popoverContent, ...props}: ResultTagProps) => {
    const classes = useStyles()

    const content =
        value2 !== undefined ? (
            <>
                <span className="value1">{value1}</span>
                <span className="value2">{value2}</span>
            </>
        ) : (
            <div className="singleValue">{value1}</div>
        )

    const tag = (
        <Tag className={classes.resultTag} {...props}>
            {content}
        </Tag>
    )

    return popoverContent ? (
        <Popover
            placement="bottom"
            trigger="click"
            overlayStyle={{width: 240}}
            arrow={false}
            title={popoverContent}
        >
            {tag}
        </Popover>
    ) : (
        tag
    )
})

export default ResultTag
