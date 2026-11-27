import {memo} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {Tray} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue} from "jotai"

import {useAnnotationNavigation} from "../../context"

import type {EmptyQueueStateProps} from "./assets/type"

const EmptyQueueState = memo(function EmptyQueueState({onViewChange}: EmptyQueueStateProps) {
    const navigation = useAnnotationNavigation()
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const isTraces = queueKind === "traces"

    return (
        <div className="flex flex-col flex-1 items-center justify-center gap-4 min-h-0">
            <div className="flex items-center justify-center size-20 rounded-md bg-muted">
                <Tray size={32} className="text-muted-foreground" />
            </div>

            <div className="flex flex-col items-center gap-2 text-center">
                <Typography.Text strong className="!text-title">
                    There&apos;s nothing to see here
                </Typography.Text>
                <Typography.Text type="secondary" className="text-body">
                    Currently there are no runs &amp; annotations in this queue,
                    <br />
                    {isTraces ? "please add runs from traces." : "please add items from test sets."}
                </Typography.Text>
            </div>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={() => onViewChange("list")}>
                    View previous annotations
                </Button>
                {isTraces && navigation.navigateToObservability && (
                    <Button
                        size="small"
                        type="primary"
                        className="!bg-primary !border-primary hover:!bg-primary-hover hover:!border-primary-hover"
                        onClick={() => navigation.navigateToObservability?.()}
                    >
                        Go to observability
                    </Button>
                )}
            </div>
        </div>
    )
})

export default EmptyQueueState
