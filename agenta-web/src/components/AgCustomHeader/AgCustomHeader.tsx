import {Space} from "antd"
import React, {useEffect, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {ArrowDownOutlined, ArrowUpOutlined, MenuOutlined} from "@ant-design/icons"
import {GenericObject} from "@/lib/Types"

const useStyles = createUseStyles(() => ({
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

enum Sort {
    ASC = "asc",
    DESC = "desc"
}

const AgCustomHeader: React.FC<Props & GenericObject> = ({children, ...props}) => {
    const [sortDir, setSortDir] = useState<Sort.ASC | Sort.DESC | null>(null)
    const classes = useStyles()
    const refButton = useRef(null)

    const onMenuClicked = (e: any) => {
        props.showColumnMenu(refButton.current)
        e.stopPropagation()
    }

    const onSortChanged = () => {
        setSortDir(
            props.column.isSortAscending()
                ? Sort.ASC
                : props.column.isSortDescending()
                  ? Sort.DESC
                  : null,
        )
    }

    const onSortRequested = (order: string, event: GenericObject) => {
        props.setSort(order, event.shiftKey)
    }

    const onClick = (e: any) => {
        if (!props.enableSorting) return
        onSortRequested(sortDir === Sort.ASC ? Sort.DESC : sortDir === Sort.DESC ? "" : Sort.ASC, e)
    }

    useEffect(() => {
        props.column.addEventListener("sortChanged", onSortChanged)
        onSortChanged()
    }, [])

    const renderArrowIcons = () => {
        if(props.enableSorting) {
            if(sortDir === Sort.ASC) {
                return <ArrowUpOutlined />
            } else if(sortDir === Sort.DESC) {
                return <ArrowDownOutlined />
            } else {
                return null;
            }
        } else {
            return null;
        }
    }

    return (
        <Space align="center" onClick={onClick} className={classes.root}>
            <Space align="center">
                <span>{children}</span>
                {renderArrowIcons()}
            </Space>
            {props.enableMenu && <MenuOutlined ref={refButton} onClick={onMenuClicked} />}
        </Space>
    )
}

export default AgCustomHeader
