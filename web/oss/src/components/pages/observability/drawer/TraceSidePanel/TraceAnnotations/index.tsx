import React, {useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Button, Popover, Space, Typography} from "antd"
import clsx from "clsx"

import CustomAntdTag from "@/oss/components/ui/CustomAntdTag"
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
                    ([, metric]) => metric.average !== undefined,
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
                                                <Typography.Text>Total mean:</Typography.Text>
                                                <CustomAntdTag
                                                    value={`μ ${metric.average}`}
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
                                                    <Space
                                                        className="items-center justify-between"
                                                        key={i}
                                                    >
                                                        <UserAvatarTag
                                                            modifiedBy={annotation.user || ""}
                                                        />
                                                        <Typography.Text type="secondary">
                                                            {getStringOrJson(annotation.value)}
                                                        </Typography.Text>
                                                    </Space>
                                                ),
                                            )}
                                        </div>
                                    }
                                >
                                    <div
                                        className={clsx(
                                            "flex items-center justify-between",
                                            "py-1 px-3 cursor-pointer",
                                            "rounded-lg border border-[#BDC7D1] border-solid",
                                        )}
                                    >
                                        <Typography.Text className="truncate overflow-hidden text-ellipsis w-[200px]">
                                            {key}
                                        </Typography.Text>
                                        <Typography.Text type="secondary">{`μ ${metric.average}`}</Typography.Text>
                                    </div>
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
