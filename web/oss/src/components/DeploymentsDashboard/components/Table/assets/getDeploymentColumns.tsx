import {MoreOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise, GearSix, Lightning, Note} from "@phosphor-icons/react"
import {Dropdown, Button} from "antd"
import {ColumnsType} from "antd/es/table"
import {NextRouter} from "next/router"

import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import {buildRevisionsQueryParam} from "@/oss/lib/helpers/url"
import {DeploymentRevisions} from "@/oss/lib/Types"

import {DeploymentRevisionWithVariant} from "../../.."
import VariantDetailsRenderer from "../../../assets/VariantDetailsRenderer"

export const getColumns = ({
    setSelectedRevisionRow,
    setIsRevertModalOpen,
    setSelectedVariantRevisionIdToRevert,
    handleAssignRevisionId,
    envRevisions,
    router,
    appId,
    appURL,
}: {
    setSelectedRevisionRow: React.Dispatch<
        React.SetStateAction<DeploymentRevisionWithVariant | undefined>
    >
    setIsRevertModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setSelectedVariantRevisionIdToRevert: React.Dispatch<React.SetStateAction<string>>
    handleAssignRevisionId: (record: DeploymentRevisionWithVariant) => void
    envRevisions: DeploymentRevisions | undefined
    router: NextRouter
    appId: string
    appURL: string
}): ColumnsType<DeploymentRevisionWithVariant> => {
    const columns: ColumnsType<DeploymentRevisionWithVariant> = [
        {
            title: "Revision",
            dataIndex: "revision",
            key: "revision",
            fixed: "left",
            width: 88,
            onHeaderCell: () => ({
                style: {minWidth: 88},
            }),
            render: (_, record) => {
                return <div>v{record.environment_revision}</div>
            },
        },
        {
            title: "Variant",
            dataIndex: "variant_name",
            key: "variant_name",
            fixed: "left",
            width: 280,
            onHeaderCell: () => ({
                style: {minWidth: 280},
            }),
            render: (_, record) => {
                return <VariantDetailsRenderer record={record} />
            },
        },
        {
            title: "Notes",
            dataIndex: "commit_message",
            key: "commit_message",
            width: 280,
            onHeaderCell: () => ({
                style: {minWidth: 280},
            }),
            className: "overflow-hidden text-ellipsis whitespace-nowrap max-w-[280px]",
            render: (_, record) => {
                return record.commit_message ? (
                    <div onClick={(e) => e.stopPropagation()}>
                        <TruncatedTooltipTag children={record.commit_message} width={560} />
                    </div>
                ) : null
            },
        },
        {
            title: "Date modified",
            dataIndex: "created_at",
            key: "created_at",
            width: 160,
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <div onClick={(e) => e.stopPropagation()}>{record.created_at}</div>
            },
        },
    ]

    columns.push({
        title: "Modified by",
        dataIndex: "modified_by",
        key: "modified_by",
        width: 160,
        onHeaderCell: () => ({
            style: {minWidth: 160},
        }),
        render: (_, record) => {
            return <div>{record.modified_by}</div>
        },
    })

    columns.push({
        title: <GearSix size={16} />,
        key: "key",
        width: 56,
        fixed: "right",
        align: "center",
        render: (_, record) => {
            return (
                <Dropdown
                    trigger={["click"]}
                    overlayStyle={{width: 180}}
                    menu={{
                        items: [
                            {
                                key: "details",
                                label: "Open details",
                                icon: <Note size={16} />,
                                onClick: (e) => {
                                    e.domEvent.stopPropagation()
                                    setSelectedRevisionRow(record)
                                    handleAssignRevisionId(record)
                                },
                            },
                            {
                                key: "view_variant",
                                label: "Open in playground",
                                icon: <Lightning size={16} />,
                                onClick: (e) => {
                                    e.domEvent.stopPropagation()
                                    router.push({
                                        pathname: `${appURL}/playground`,
                                        query: {
                                            revisions: buildRevisionsQueryParam([
                                                record.variant?.id,
                                            ]),
                                        },
                                    })
                                },
                                disabled: !record.variant,
                            },
                            {
                                key: "revert",
                                label: "Revert",
                                icon: <ArrowCounterClockwise size={16} />,
                                onClick: (e) => {
                                    e.domEvent.stopPropagation()
                                    setIsRevertModalOpen(true)
                                    setSelectedVariantRevisionIdToRevert(
                                        record.deployed_app_variant_revision,
                                    )
                                },
                                disabled:
                                    record.deployed_app_variant_revision ===
                                    (envRevisions?.deployed_app_variant_revision_id || ""),
                            },
                        ],
                    }}
                >
                    <Button
                        onClick={(e) => e.stopPropagation()}
                        type="text"
                        icon={<MoreOutlined />}
                    />
                </Dropdown>
            )
        },
    })

    return columns
}
