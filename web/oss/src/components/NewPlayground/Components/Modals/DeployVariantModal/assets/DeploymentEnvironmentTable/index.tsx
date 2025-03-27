import {useMemo} from "react"

import {Typography, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"

import DeploymentTag from "@/oss/components/NewPlayground/assets/DeploymentTag"
import {Environment} from "@/oss/lib/Types"

import {DeploymentEnvironmentTableProps} from "./types"

const DeploymentEnvironmentTable = ({
    selectedEnvs,
    setSelectedEnvs,
    variantId,
    variantName,
    revision,
    environments,
    isLoading,
}: DeploymentEnvironmentTableProps) => {
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
                        <div className="flex items-center justify-start">
                            {record.deployed_app_variant_revision_id ? (
                                <DeploymentTag
                                    deploymentName="Variant"
                                    deployedVariantId={
                                        record.deployed_app_variant_revision_id as string
                                    }
                                    className="flex items-center justify-center"
                                />
                            ) : (
                                <Tag color="default" bordered={false}>
                                    No deployment
                                </Tag>
                            )}
                        </div>
                    )
                },
            },
        ],
        [environments],
    )

    return (
        <>
            <Typography>
                Select an environment to deploy {variantName} v{revision}
            </Typography>

            <Table
                rowSelection={{
                    type: "checkbox",
                    columnWidth: 48,
                    onChange: (selectedRowKeys: React.Key[]) => {
                        setSelectedEnvs(selectedRowKeys as string[])
                    },
                }}
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

export default DeploymentEnvironmentTable
