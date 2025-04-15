import {JSSTheme} from "@/oss/lib/Types"
import {CloseOutlined} from "@ant-design/icons"
import {Button, Input, Modal, Typography} from "antd"
import React, {Key, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {DeploymentRevisions} from "@/oss/lib/Types"
import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

type SelectDeployVariantModalProps = {
    variants: EnhancedVariant[]
    envRevisions: DeploymentRevisions | undefined
    setIsDeployVariantModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setSelectedRowKeys: React.Dispatch<React.SetStateAction<Key[]>>
    selectedRowKeys: Key[]
} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightStrong,
        lineHeight: theme.lineHeightLG,
        textTransform: "capitalize",
    },
    container: {
        "& .ant-modal-body": {
            height: 600,
            overflow: "auto",
        },
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

const SelectDeployVariantModal = ({
    variants,
    envRevisions,
    setIsDeployVariantModalOpen,
    setSelectedRowKeys,
    selectedRowKeys,
    ...props
}: SelectDeployVariantModalProps) => {
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState("")

    const filtered = useMemo(() => {
        if (!searchTerm) return variants
        if (variants) {
            return variants.filter(
                (item) =>
                    item.variantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    item.commitMessage?.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
    }, [searchTerm, variants])

    return (
        <EnhancedModal
            closeIcon={null}
            title={
                <div className="flex items-center justify-between">
                    <Typography.Text className={classes.title}>
                        Deploy {envRevisions?.name}
                    </Typography.Text>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                </div>
            }
            okButtonProps={{
                disabled: !selectedRowKeys.length,
                onClick: () => setIsDeployVariantModalOpen(true),
            }}
            okText="Deploy"
            width={1200}
            className={classes.container}
            {...props}
        >
            <div className="flex flex-col gap-4 flex-1 mt-4">
                <Input.Search
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search"
                    allowClear
                    className="w-[400px]"
                />

                <VariantsTable
                    variants={filtered || []}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (value) => setSelectedRowKeys(value),
                        type: "radio",
                    }}
                    isLoading={false}
                    onRowClick={() => null}
                    rowKey={"id"}
                    className={classes.table}
                    showActionsDropdown={false}
                    showEnvBadges
                />
            </div>
        </EnhancedModal>
    )
}

export default SelectDeployVariantModal
