import {Dropdown, Button, MenuProps} from "antd"
import {memo, useMemo} from "react"
import {Database, Note, Rocket, Trash} from "@phosphor-icons/react"
import {MoreOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"
import {useAppId} from "@/oss/hooks/useAppId"
import {TableDropdownMenuProps} from "./types"
import {EvaluationStatus} from "@/oss/lib/Types"

const TableDropdownMenu = ({
    record,
    evalType,
    setSelectedEvalRecord,
    setIsDeleteEvalModalOpen,
    onVariantNavigation,
}: TableDropdownMenuProps) => {
    const router = useRouter()
    const appId = useAppId()

    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "details",
                label: "Open details",
                icon: <Note size={16} />,
                disabled: [
                    EvaluationStatus.PENDING,
                    EvaluationStatus.RUNNING,
                    EvaluationStatus.CANCELLED,
                    EvaluationStatus.INITIALIZED,
                ].includes(record.status),
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    if (
                        evalType === "auto" &&
                        ![
                            EvaluationStatus.PENDING,
                            EvaluationStatus.RUNNING,
                            EvaluationStatus.CANCELLED,
                            EvaluationStatus.INITIALIZED,
                        ].includes(record.status)
                    )
                        router.push(
                            `/apps/${appId}/evaluations/${evalType == "auto" ? "results" : "single_model_test"}/${"id" in record ? record.id : record.key}`,
                        )
                },
            },
            {
                key: "variant",
                label: "View variant",
                icon: <Rocket size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    onVariantNavigation(record.variants[0].id)
                },
            },
            {
                key: "view_testset",
                label: "View test set",
                icon: <Database size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    router.push(`/testsets/${record.testsets?.[0]?.id}`)
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
        [setSelectedEvalRecord, setIsDeleteEvalModalOpen, record, onVariantNavigation, evalType],
    )
    return (
        <Dropdown trigger={["click"]} overlayStyle={{width: 180}} menu={{items}}>
            <Button onClick={(e) => e.stopPropagation()} type="text" icon={<MoreOutlined />} />
        </Dropdown>
    )
}

export default memo(TableDropdownMenu)
