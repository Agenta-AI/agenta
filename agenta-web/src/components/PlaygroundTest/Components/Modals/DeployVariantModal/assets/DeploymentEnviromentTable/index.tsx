import {useMemo} from "react"
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
    environments,
    isLoading,
}: DeploymentEnviromentTableProps) => {
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
                                    className="w-[140px] flex items-center justify-center"
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
        [environments],
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
                    onChange: (selectedRowKeys: React.Key[]) => {
                        setSelectedEnvs(selectedRowKeys as string[])
                    },
                }}
                data-cy="app-testset-list"
                loading={isLoading}
                className={`ph-no-capture`}
                columns={columns}
                dataSource={environments}
                rowKey="name"
                pagination={false}
                bordered
            />
        </>
    )
}

export default DeploymentEnviromentTable
