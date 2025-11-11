import {memo, useMemo} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {Database, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Dropdown, Button, MenuProps} from "antd"
import {useRouter} from "next/router"

import {EvaluationStatus} from "@/oss/lib/Types"
import {
    buildAppScopedUrl,
    buildEvaluationNavigationUrl,
    extractPrimaryInvocation,
} from "../../../pages/evaluations/utils"

import {TableDropdownMenuProps} from "./types"

const TableDropdownMenu = ({
    record,
    evalType,
    setSelectedEvalRecord,
    setIsDeleteEvalModalOpen,
    onVariantNavigation,
    baseAppURL,
    extractAppId,
    scope,
    projectURL,
    resolveAppId,
}: TableDropdownMenuProps) => {
    const router = useRouter()
    const primaryInvocation = extractPrimaryInvocation(record)
    const resolvedAppId = resolveAppId ? resolveAppId(record) : undefined
    const targetAppId = resolvedAppId || primaryInvocation?.appId || extractAppId(record)
    const variantId = primaryInvocation?.revisionId || record.variants?.[0]?.id

    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "details",
                label: "Open details",
                icon: <Note size={16} />,
                disabled:
                    [
                        EvaluationStatus.PENDING,
                        EvaluationStatus.RUNNING,
                        EvaluationStatus.CANCELLED,
                        EvaluationStatus.INITIALIZED,
                    ].includes(record.status) || !targetAppId,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (
                        evalType === "auto" &&
                        ![
                            EvaluationStatus.PENDING,
                            EvaluationStatus.RUNNING,
                            EvaluationStatus.CANCELLED,
                            EvaluationStatus.INITIALIZED,
                        ].includes(record.status) &&
                        targetAppId
                    ) {
                        const evaluationId = "id" in record ? record.id : record.key
                        const suffix =
                            evalType === "auto"
                                ? `/evaluations/results/${evaluationId}`
                                : `/evaluations/single_model_test/${evaluationId}`
                        const pathname = buildEvaluationNavigationUrl({
                            scope,
                            baseAppURL,
                            projectURL,
                            appId: targetAppId,
                            path: suffix,
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
                },
            },
            {
                key: "variant",
                label: "View variant",
                icon: <Rocket size={16} />,
                disabled: !variantId || !targetAppId,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (!variantId) return
                    onVariantNavigation({revisionId: variantId, appId: targetAppId || undefined})
                },
            },
            {
                key: "view_testset",
                label: "View test set",
                icon: <Database size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    router.push(`${projectURL}/testsets/${record.testsets?.[0]?.id}`)
                },
            },
            {type: "divider"},
            {
                key: "delete_eval",
                label: "Delete",
                icon: <Trash size={16} />,
                danger: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    setSelectedEvalRecord(record)
                    setIsDeleteEvalModalOpen(true)
                },
            },
        ],
        [
            setSelectedEvalRecord,
            setIsDeleteEvalModalOpen,
            record,
            onVariantNavigation,
            evalType,
            targetAppId,
            baseAppURL,
            variantId,
            projectURL,
            primaryInvocation,
            scope,
        ],
    )
    return (
        <Dropdown trigger={["click"]} overlayStyle={{width: 180}} menu={{items}}>
            <Button onClick={(e) => e.stopPropagation()} type="text" icon={<MoreOutlined />} />
        </Dropdown>
    )
}

export default memo(TableDropdownMenu)
