import React, {useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Button, Popover, Space, Typography} from "antd"

import CustomAntdTag from "@/oss/components/ui/CustomAntdTag"
import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import UserAvatarTag from "@/oss/components/ui/UserAvatarTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {groupAnnotationsByReferenceId} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

import {useStyles} from "./assets/styles"
import NoTraceAnnotations from "./components/NoTraceAnnotations"

interface TraceAnnotationsProps {
    annotations: AnnotationDto[]
}

const TraceAnnotations = ({annotations}: TraceAnnotationsProps) => {
    const classes = useStyles()
    const [isAnnotationsPopoverOpen, setIsAnnotationsPopoverOpen] = useState<string | null>(null)
    const getPopoverKey = (refId: string, key: string) => `${refId}-${key}`
    const grouped = groupAnnotationsByReferenceId(annotations)

    return Object.entries(grouped).length > 0 ? (
        <div className="flex flex-col gap-3">
            {Object.entries(grouped).map(([refId, metricsArr], index) => {
                const filteredMetrics = Object.entries(metricsArr).filter(
                    ([, metric]) => metric.average !== undefined || metric.latest !== undefined,
                )

                if (filteredMetrics.length === 0) return null

                return (
                    <div key={index} className="flex flex-col gap-[6px]">
                        <Typography.Text type="secondary" className="text-[10px]">
                            {refId}
                        </Typography.Text>

                        {filteredMetrics.map(([key, metric], index) => (
                            <div key={index}>
                                <Popover
                                    overlayClassName={classes.annotationPopover}
                                    open={isAnnotationsPopoverOpen === getPopoverKey(refId, key)}
                                    onOpenChange={(open) => {
                                        setIsAnnotationsPopoverOpen(
                                            open ? getPopoverKey(refId, key) : null,
                                        )
                                    }}
                                    placement="bottom"
                                    trigger="click"
                                    arrow={false}
                                    title={
                                        <div className="flex items-center justify-between">
                                            <Space className="truncate overflow-hidden">
                                                <Typography.Text>{key}</Typography.Text>
                                                <CustomAntdTag
                                                    value={`μ ${metric.average ?? metric.latest}`}
                                                    bordered={false}
                                                />
                                            </Space>
                                            <Button
                                                type="text"
                                                icon={<CloseOutlined />}
                                                onClick={() => setIsAnnotationsPopoverOpen(null)}
                                            />
                                        </div>
                                    }
                                    content={
                                        <div className="flex flex-col gap-2">
                                            {metric.annotations?.map(
                                                (annotation: any, i: number) => (
                                                    <Space key={i}>
                                                        <Typography.Text>
                                                            {getStringOrJson(annotation.value)}
                                                        </Typography.Text>
                                                        <UserAvatarTag
                                                            modifiedBy={annotation.user || ""}
                                                        />
                                                    </Space>
                                                ),
                                            )}
                                        </div>
                                    }
                                >
                                    <span className="cursor-pointer inline-block">
                                        <LabelValuePill
                                            label={key}
                                            value={`μ ${metric.average ?? metric.latest}`}
                                            className="w-fit"
                                        />
                                    </span>
                                </Popover>
                            </div>
                        ))}
                    </div>
                )
            })}
        </div>
    ) : (
        <NoTraceAnnotations />
    )
}

export default TraceAnnotations
