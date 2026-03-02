import {useMemo} from "react"

import {Typography, Table} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom, useAtomValue} from "jotai"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import CommitNote from "@/oss/components/Playground/assets/CommitNote"
import Version from "@/oss/components/Playground/assets/Version"
import VariantNameCell from "@/oss/components/VariantNameCell"

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
                render: (_, record) => (
                    <VariantNameCell
                        revisionId={record.deployedAppVariantRevisionId as any}
                        showBadges={false}
                    />
                ),
            },
        ],
        [],
    )

    return (
        <section className="flex flex-col gap-4" data-tour="deploy-variant-modal">
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
                dataSource={data as any}
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
