import React, {useMemo, useState} from "react"
import {Modal, Typography, Table, Input} from "antd"
import {DeployVariantModalProps} from "./types"
import {ColumnsType} from "antd/es/table"
import {Rocket} from "@phosphor-icons/react"

const {Text} = Typography

const DeployVariantModal: React.FC<DeployVariantModalProps> = ({
    variant,
    environments,
    ...props
}) => {
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [current, setCurrent] = useState(0)

    const onClose = (e: any) => {
        props.onCancel?.(e)
        setCurrent(0)
    }

    const rowSelection = useMemo(
        () => ({
            onChange: (selectedRowKeys: React.Key[]) => {
                setSelectedRowKeys(selectedRowKeys)
            },
        }),
        [],
    )

    const columns: ColumnsType = useMemo(
        () => [
            {
                title: "Environment",
                dataIndex: "environment",
                key: "environment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
            },
            {
                title: "Current deployment",
                dataIndex: "deployment",
                key: "deployment",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
            },
        ],
        [],
    )

    const steps = useMemo(
        () => [
            {
                title: "Deploy variant",
                onClick: () => {
                    setCurrent(1)
                },
                component: (
                    <>
                        <Text>Select an environment to deploy app.default v2.1</Text>

                        <Table
                            rowSelection={{
                                type: "checkbox",
                                columnWidth: 48,
                                ...rowSelection,
                            }}
                            data-cy="app-testset-list"
                            className={`ph-no-capture`}
                            columns={columns}
                            // dataSource={filteredTestset}
                            rowKey="_id"
                            pagination={false}
                        />
                    </>
                ),
            },
            {
                title: "Confirm deployment",
                onClick: () => {},
                component: (
                    <>
                        <div className="flex flex-col gap-1">
                            <Text>You are about to deploy staging environment</Text>
                            <Text>Revision v6</Text>
                        </div>

                        <div className="flex flex-col gap-1">
                            <Text>Notes (optional)</Text>
                            <Input.TextArea
                                placeholder="Describe why you are deploying"
                                className="w-full"
                            />
                        </div>
                    </>
                ),
            },
        ],
        [current, rowSelection],
    )

    return (
        <Modal
            title={steps[current]?.title}
            onCancel={onClose}
            okText="Deploy"
            onOk={steps[current]?.onClick}
            okButtonProps={{icon: <Rocket size={14} />}}
            centered
            destroyOnClose
            {...props}
        >
            <section className="flex flex-col gap-4">{steps[current]?.component}</section>
        </Modal>
    )
}

export default DeployVariantModal
