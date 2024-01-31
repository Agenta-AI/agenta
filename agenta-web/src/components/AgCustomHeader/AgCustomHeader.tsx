import {GenericObject, JSSTheme} from "@/lib/Types"
import {ArrowDownOutlined, ArrowUpOutlined, MenuOutlined} from "@ant-design/icons"
import {Space} from "antd"
import React, {useEffect, useRef, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        justifyContent: "space-between",
        width: "100%",
        cursor: "pointer",
        "& .anticon-menu": {
            fontSize: 10,
            opacity: 0,
            transition: "opacity 0.2s",
        },
        "&:hover": {
            "& .anticon-menu": {
                opacity: 1,
            },
        },
    },
}))

interface Props {
    children: React.ReactNode
}

const AgCustomHeader: React.FC<Props & GenericObject> = ({children, ...props}) => {
    const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null)
    const classes = useStyles()
    const refButton = useRef(null)

    const onMenuClicked = (e: any) => {
        props.showColumnMenu(refButton.current)
        e.stopPropagation()
    }

    const onSortChanged = () => {
        setSortDir(
            props.column.isSortAscending()
                ? "asc"
                : props.column.isSortDescending()
                ? "desc"
                : null,
        )
    }

    const onSortRequested = (order: string, event: GenericObject) => {
        props.setSort(order, event.shiftKey)
    }

    const onClick = (e: any) => {
        if (!props.enableSorting) return
        onSortRequested(sortDir === "asc" ? "desc" : sortDir === "desc" ? "" : "asc", e)
    }

    useEffect(() => {
        props.column.addEventListener("sortChanged", onSortChanged)
        onSortChanged()
    }, [])

    return (
        <Space align="center" onClick={onClick} className={classes.root}>
            <Space align="center">
                <span>{children}</span>
                {props.enableSorting ? (
                    sortDir === "asc" ? (
                        <ArrowUpOutlined />
                    ) : sortDir === "desc" ? (
                        <ArrowDownOutlined />
                    ) : null
                ) : null}
            </Space>
            {props.enableMenu && <MenuOutlined ref={refButton} onClick={onMenuClicked} />}
        </Space>
    )
}

export default AgCustomHeader
