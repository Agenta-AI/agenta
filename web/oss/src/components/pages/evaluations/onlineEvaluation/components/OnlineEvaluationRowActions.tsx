import {memo, useMemo, useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {Note, Play, Stop, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps, message} from "antd"
import {useRouter} from "next/router"

import {startSimpleEvaluation, stopSimpleEvaluation} from "@/oss/services/onlineEvaluations/api"

import {extractPrimaryInvocation, buildEvaluationNavigationUrl} from "../../utils"
import {EvaluationRow} from "../types"

interface OnlineEvaluationRowActionsProps {
    record: EvaluationRow
    baseAppURL: string
    projectURL: string
    scope: "app" | "project"
    extractAppId: (evaluation: EvaluationRow) => string | undefined
    setSelectedEvalRecord: (record: EvaluationRow | undefined) => void
    setIsDeleteEvalModalOpen: (value: boolean) => void
    mutate?: () => Promise<void>
}

const OnlineEvaluationRowActions = ({
    record,
    baseAppURL,
    projectURL,
    scope,
    extractAppId,
    setSelectedEvalRecord,
    setIsDeleteEvalModalOpen,
    mutate,
}: OnlineEvaluationRowActionsProps) => {
    const router = useRouter()
    const [loadingKey, setLoadingKey] = useState<string | null>(null)
    const primaryInvocation = extractPrimaryInvocation(record)
    const targetAppId = extractAppId(record) || primaryInvocation?.appId
    const evaluationId = "id" in record ? record.id : record.key
    const flags = ((record as any)?.flags || {}) as {
        isActive?: boolean
        isClosed?: boolean
    }
    const isActive = Boolean(flags?.isActive ?? flags?.is_active)
    const isClosed = Boolean(flags?.isClosed ?? flags?.is_closed)
    const canStart = !isActive && !isClosed
    const canStop = isActive

    const handleNavigateDetails = () => {
        const pathname = buildEvaluationNavigationUrl({
            scope,
            baseAppURL,
            projectURL,
            appId: targetAppId,
            path: `/evaluations/results/${evaluationId}`,
        })
        if (scope === "project") {
            router.push({
                pathname,
                query: targetAppId ? {app_id: targetAppId} : undefined,
            })
        } else {
            router.push(pathname)
        }
    }

    const handleAction = async (type: "start" | "stop") => {
        if (!evaluationId) return
        setLoadingKey(type)
        try {
            if (type === "start") {
                await startSimpleEvaluation(evaluationId)
                message.success("Evaluation started")
            } else {
                await stopSimpleEvaluation(evaluationId)
                message.success("Evaluation stopped")
            }
            await mutate?.()
        } catch (error) {
            message.error(
                type === "start" ? "Failed to start evaluation" : "Failed to stop evaluation",
            )
        } finally {
            setLoadingKey(null)
        }
    }

    const items: MenuProps["items"] = useMemo(() => {
        const menuItems: MenuProps["items"] = [
            {
                key: "details",
                label: "Open details",
                icon: <Note size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    handleNavigateDetails()
                },
            },
        ]

        if (canStart || canStop) {
            if (canStart) {
                menuItems.push({
                    key: "start",
                    label: "Start evaluation",
                    icon: <Play size={16} />,
                    onClick: (e) => {
                        e.domEvent.stopPropagation()
                        handleAction("start")
                    },
                    disabled: loadingKey !== null,
                })
            }
            if (canStop) {
                menuItems.push({
                    key: "stop",
                    label: "Stop evaluation",
                    icon: <Stop size={16} />,
                    onClick: (e) => {
                        e.domEvent.stopPropagation()
                        handleAction("stop")
                    },
                    disabled: loadingKey !== null,
                })
            }
        }

        menuItems.push(
            {type: "divider"},
            {
                key: "delete",
                label: "Delete",
                icon: <Trash size={16} />,
                danger: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    setSelectedEvalRecord(record)
                    setIsDeleteEvalModalOpen(true)
                },
            },
        )
        return menuItems
    }, [
        canStart,
        canStop,
        handleNavigateDetails,
        loadingKey,
        record,
        setIsDeleteEvalModalOpen,
        setSelectedEvalRecord,
        targetAppId,
    ])

    return (
        <Dropdown trigger={["click"]} overlayStyle={{width: 180}} menu={{items}}>
            <Button
                onClick={(e) => e.stopPropagation()}
                type="text"
                icon={<MoreOutlined />}
                loading={loadingKey !== null}
            />
        </Dropdown>
    )
}

export default memo(OnlineEvaluationRowActions)
