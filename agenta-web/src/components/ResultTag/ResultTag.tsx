import {memo} from "react"

import clsx from "clsx"

import {Popover, Tag} from "antd"
import {useStyles} from "./assets/styles"
import type {ResultTagProps} from "./types"

const ResultTag = memo(({value1, value2, className, popoverContent, ...props}: ResultTagProps) => {
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
        <Tag className={clsx(classes.resultTag, className)} {...props}>
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
