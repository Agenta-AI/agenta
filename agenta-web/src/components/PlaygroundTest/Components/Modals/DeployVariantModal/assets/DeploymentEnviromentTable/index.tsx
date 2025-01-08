import {useMemo, useState} from "react"
import {Typography, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import DeploymentTag from "@/components/PlaygroundTest/assets/DeploymentTag"
import {DeploymentEnviromentTableProps} from "./types"
import {Environment} from "@/lib/Types"

const DeploymentEnviromentTable = ({
    selectedEnvs,
    setSelectedEnvs,
    variantId,
    variant,
}: DeploymentEnviromentTableProps) => {
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const rowSelection = useMemo(
        () => ({
            onChange: (selectedRowKeys: React.Key[]) => {
                setSelectedRowKeys(selectedRowKeys)
                setSelectedEnvs(selectedRowKeys as string[])
            },
        }),
        [],
    )

    const columns: ColumnsType<Environment> = useMemo(
        () => [
            {
                title: "Environment",
                dataIndex: "environment",
                key: "environment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => record.name,
            },
            {
                title: "Current deployment",
                dataIndex: "deployment",
                key: "deployment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return (
                        <>
                            {record.deployed_app_variant_id ? (
                                <DeploymentTag
                                    deploymentName="Variant"
                                    deployedVariantId={variantId}
                                    className="!w-auto"
                                />
                            ) : (
                                <Tag color="default" bordered={false}>
                                    No deployment
                                </Tag>
                            )}
                        </>
                    )
                },
            },
        ],
        [],
    )

    return (
        <>
            <Typography>
                Select an environment to deploy {variant?.variantName} v{variant?.revision}
            </Typography>

            <Table
                rowSelection={{
                    type: "checkbox",
                    columnWidth: 48,
                    ...rowSelection,
                }}
                data-cy="app-testset-list"
                className={`ph-no-capture`}
                columns={columns}
                dataSource={[]}
                rowKey="_id"
                pagination={false}
                bordered
            />
        </>
    )
}

export default DeploymentEnviromentTable
