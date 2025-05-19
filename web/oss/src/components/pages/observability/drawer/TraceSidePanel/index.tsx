import React from "react"

import {Collapse, CollapseProps, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

import {TracesWithAnnotations} from "../../ObservabilityDashboard"

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

const TraceSidePanel = ({activeTrace}: {activeTrace: TracesWithAnnotations}) => {
    const classes = useStyles()

    const items: CollapseProps["items"] = [
        {
            key: "annotations",
            label: (
                <Typography.Text className={classes.collapseItemLabel}>Annotations</Typography.Text>
            ),
            children: <TraceAnnotations annotations={activeTrace.annotations || []} />,
        },
        {
            key: "details",
            label: <Typography.Text className={classes.collapseItemLabel}>Details</Typography.Text>,
            children: <TraceDetails activeTrace={activeTrace} />,
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
