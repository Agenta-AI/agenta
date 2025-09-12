import React from "react"
import {useMemo} from "react"

import {Collapse, CollapseProps, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"
import {TracesWithAnnotations} from "@/oss/services/observability/types"

import useTraceDrawer from "../hooks/useTraceDrawer"

import TraceAnnotations from "./TraceAnnotations"
import TraceDetails from "./TraceDetails"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontWeight: theme.fontWeightMedium,
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
    },
    collapseContainer: {
        transition: "all 0.3s ease",
        maxWidth: "100%",
        overflow: "hidden",
        opacity: 1,
        borderRadius: 0,
        border: 0,
        "& .ant-collapse-content": {
            borderColor: theme.colorSplit,
            "& .ant-collapse-content-box": {
                padding: theme.paddingSM,
            },
        },
        "& .ant-collapse-item": {
            borderColor: theme.colorSplit,
        },
    },
    collapseItemLabel: {
        fontSize: theme.fontSize,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeight,
    },
}))

const TraceSidePanel = ({
    activeTrace,
    activeTraceId,
}: {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
}) => {
    const classes = useStyles()
    const {getTraceById} = useTraceDrawer()
    const derived = activeTrace || getTraceById(activeTraceId)

    const items: CollapseProps["items"] = [
        {
            key: "annotations",
            label: (
                <Typography.Text className={classes.collapseItemLabel}>Annotations</Typography.Text>
            ),
            children: <TraceAnnotations annotations={derived?.annotations || []} />,
        },
        {
            key: "details",
            label: <Typography.Text className={classes.collapseItemLabel}>Details</Typography.Text>,
            children: <TraceDetails activeTrace={derived as any} />,
        },
    ]

    return (
        <Collapse
            items={items}
            defaultActiveKey={["annotations", "details"]}
            className={classes.collapseContainer}
        />
    )
}

export default TraceSidePanel
