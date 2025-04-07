import {useMemo} from "react"

import {Typography, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import CommitNote from "@/oss/components/NewPlayground/assets/CommitNote"
import Version from "@/oss/components/NewPlayground/assets/Version"

import {ExtendedEnvironment} from "../../types"

import {DeployVariantModalContentProps} from "./types"

const DeployVariantModalContent = ({
    selectedEnvName,
    setSelectedEnvName,
    variantName,
    revision,
    environments,
    isLoading,
    note,
    setNote,
}: DeployVariantModalContentProps) => {
    const columns: ColumnsType<ExtendedEnvironment> = useMemo(
        () => [
            {
                title: "Environment",
                dataIndex: "environment",
                key: "environment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return <EnvironmentTagLabel environment={record.name} />
                },
            },
            {
                title: "Current variant",
                dataIndex: "deployment",
                key: "deployment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return record.deployed_variant_name ? (
                        <div className="flex items-center justify-start">
                            {record.revision ? (
                                <div className="flex items-center justify-center gap-1">
                                    {record.revision.name}{" "}
                                    <Version revision={record.revision.revisionNumber} />
                                </div>
                            ) : (
                                <Tag color="default" bordered={false} className="-ml-1">
                                    No deployment
                                </Tag>
                            )}
                        </div>
                    ) : (
                        "-"
                    )
                },
            },
        ],
        [environments],
    )

    return (
        <section className="flex flex-col gap-4">
            <Typography.Text>
                Select an environment to deploy <span className="font-medium">{variantName}</span>{" "}
                {typeof revision !== "undefined" && <Version revision={revision} />}
            </Typography.Text>

            <Table
                rowSelection={{
                    type: "radio",
                    columnWidth: 48,
                    selectedRowKeys: selectedEnvName,
                    onChange: (selectedRowKeys: React.Key[]) => {
                        setSelectedEnvName(selectedRowKeys as string[])
                    },
                }}
                loading={isLoading}
                className={`ph-no-capture`}
                columns={columns}
                dataSource={environments}
                rowKey="name"
                pagination={false}
                bordered
                onRow={(env) => ({
                    className: "cursor-pointer",
                    onClick: () => {
                        setSelectedEnvName([env.name])
                    },
                })}
            />

            <CommitNote note={note} setNote={setNote} />
        </section>
    )
}

export default DeployVariantModalContent
