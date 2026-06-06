import {useMemo} from "react"

import {VariantNameCell} from "@agenta/entity-ui/variant"
import {CommitMessageInput, EnvironmentTag, VersionBadge} from "@agenta/ui"
import {Typography, Table} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom, useAtomValue} from "jotai"

import {deployNoteAtom, deploySelectedEnvAtom} from "../../store/deployVariantModalStore"

import {deployModalEnvironmentsTableAtom, type DeployModalEnvRow} from "./tableDataAtom"

const DeployVariantModalContent = ({variantName, revision, isLoading}: any) => {
    const data = useAtomValue(deployModalEnvironmentsTableAtom)
    const [selectedEnvName, setSelectedEnvName] = useAtom(deploySelectedEnvAtom)
    const [note, setNote] = useAtom(deployNoteAtom)

    const columns: ColumnsType<DeployModalEnvRow> = useMemo(
        () => [
            {
                title: "Environment",
                dataIndex: "environment",
                key: "environment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => {
                    return <EnvironmentTag environment={record.name} />
                },
            },
            {
                title: "Current variant",
                dataIndex: "deployment",
                key: "deployment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => (
                    <VariantNameCell
                        revisionId={record.deployedAppVariantRevisionId as any}
                        revisionName={record.deployedVariantName}
                        showBadges={false}
                        hideDiscard
                    />
                ),
            },
        ],
        [],
    )

    return (
        <section className="flex flex-col gap-4" data-tour="deploy-variant-modal">
            <Typography.Text>
                Select environments to deploy{" "}
                <span className="font-medium">{variantName}</span>{" "}
                {typeof revision !== "undefined" && (
                    <VersionBadge version={revision} variant="chip" />
                )}
            </Typography.Text>

            <Table
                rowSelection={{
                    type: "checkbox",
                    columnWidth: 48,
                    selectedRowKeys: selectedEnvName,
                    onChange: (selectedRowKeys: React.Key[]) => {
                        setSelectedEnvName(selectedRowKeys as string[])
                    },
                }}
                loading={isLoading}
                className={`ph-no-capture`}
                columns={columns}
                dataSource={data as any}
                rowKey="name"
                pagination={false}
                bordered
                onRow={(env) => ({
                    className: "cursor-pointer",
                    onClick: () => {
                        setSelectedEnvName((prev) =>
                            prev.includes(env.name)
                                ? prev.filter((n) => n !== env.name)
                                : [...prev, env.name],
                        )
                    },
                })}
            />

            <CommitMessageInput value={note} onChange={setNote} />
        </section>
    )
}

export default DeployVariantModalContent
