import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {CaretRight} from "@phosphor-icons/react"
import {Badge, Input, Modal, Table, Tag, theme, Typography} from "antd"
import React, {SetStateAction, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import DeploymentModal from "./DeploymentModal"
import {formatVariantIdWithHash} from "@/lib/helpers/utils"

const {Search} = Input

type ChangeVariantModalProps = {
    variants: Variant[]
    selectedEnvironment: Environment
    setOpenChangeVariantModal: (value: SetStateAction<boolean>) => void
    loadEnvironments: () => Promise<void>
} & React.ComponentProps<typeof Modal>

const {useToken} = theme

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightStrong,
    },
    table: {
        "& .ant-table-thead > tr > th": {
            height: 32,
            padding: "0 16px",
        },
        "& .ant-table-tbody > tr > td": {
            height: 48,
            padding: "0 16px",
        },
    },
}))

const ChangeVariantModal = ({
    variants,
    selectedEnvironment,
    setOpenChangeVariantModal,
    loadEnvironments,
    ...props
}: ChangeVariantModalProps) => {
    const {token} = useToken()
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState<string>("")
    const [isDeploymentModalOpen, setIsDeploymentModalOpen] = useState(false)
    const [selectedVariant, setSelectedVariant] = useState<Variant>()

    const filtered = useMemo(() => {
        if (!searchTerm) return variants
        return variants.filter((item) =>
            item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, variants])

    return (
        <>
            <Modal width={520} centered destroyOnClose footer={null} {...props}>
                <div>
                    <Typography.Text className={classes.title}>
                        Deploy to {selectedEnvironment.name}
                    </Typography.Text>

                    <div className="flex flex-col gap-4 mt-2">
                        <Typography.Text>Choose a variant for deployment</Typography.Text>

                        <Search
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search"
                            allowClear
                        />

                        <Table
                            bordered
                            pagination={false}
                            dataSource={filtered}
                            columns={[
                                {
                                    title: "Variants",
                                    dataIndex: "variantName",
                                    key: "variantName",
                                    render: (_, record) => {
                                        return (
                                            <div className="flex items-center justify-between">
                                                <div>{record.variantName}</div>

                                                <div className="flex items-center">
                                                    <Tag>
                                                        <Badge
                                                            color={token.colorPrimary}
                                                            text={formatVariantIdWithHash(
                                                                record.variantId,
                                                            )}
                                                        />
                                                    </Tag>
                                                    <CaretRight />
                                                </div>
                                            </div>
                                        )
                                    },
                                },
                            ]}
                            onRow={(record) => ({
                                onClick: () => {
                                    setIsDeploymentModalOpen(true)
                                    setOpenChangeVariantModal(false)
                                    setSelectedVariant(record)
                                },
                                style: {cursor: "pointer"},
                            })}
                            className={classes.table}
                            scroll={{y: 300}}
                            style={{height: 330}}
                        />
                    </div>
                </div>
            </Modal>
            {selectedVariant && (
                <DeploymentModal
                    selectedEnvironment={selectedEnvironment}
                    open={isDeploymentModalOpen}
                    onCancel={() => setIsDeploymentModalOpen(false)}
                    selectedVariant={selectedVariant}
                    loadEnvironments={loadEnvironments}
                    setIsDeploymentModalOpen={setIsDeploymentModalOpen}
                />
            )}
        </>
    )
}

export default ChangeVariantModal
