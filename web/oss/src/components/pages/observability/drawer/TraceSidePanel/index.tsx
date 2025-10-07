import React from "react"
import {useMemo} from "react"

import {Collapse, CollapseProps, Typography, Skeleton} from "antd"
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
    isLoading = false,
}: {
    activeTrace?: TracesWithAnnotations
    activeTraceId?: string
    isLoading?: boolean
}) => {
    const classes = useStyles()
    const {getTraceById} = useTraceDrawer()
    const derived = activeTrace || getTraceById(activeTraceId)

    const showLoading = isLoading && !derived

    const loadingContent = (
        <div className="px-3 py-4">
            <Skeleton active paragraph={{rows: 4}} title={false} />
        </div>
    )

    const emptyState = (message: string) => (
        <div className="px-3 py-4">
            <Typography.Text type="secondary" className="text-sm">
                {message}
            </Typography.Text>
        </div>
    )

    const annotationsContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceAnnotations annotations={derived?.annotations || []} />
    ) : (
        emptyState("Select a span to view annotations.")
    )

    const detailsContent = showLoading ? (
        loadingContent
    ) : derived ? (
        <TraceDetails activeTrace={derived as any} />
    ) : (
        emptyState("Select a span to view trace details.")
    )

    const items: CollapseProps["items"] = [
        {
            key: "annotations",
            label: (
                <Typography.Text className={classes.collapseItemLabel}>Annotations</Typography.Text>
            ),
            children: annotationsContent,
        },
        {
            key: "details",
            label: <Typography.Text className={classes.collapseItemLabel}>Details</Typography.Text>,
            children: detailsContent,
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
