import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {createPublishVariant} from "@/services/deployment/api"
import {Rocket} from "@phosphor-icons/react"
import {Badge, message, Modal, Table, Tag, theme, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"

type DeployVariantModalProps = {
    environments: Environment[]
    selectedVariant: Variant
    loadEnvironments: () => Promise<void>
} & React.ComponentProps<typeof Modal>

const {useToken} = theme

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-modal-footer": {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
        },
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightStrong,
        lineHeight: theme.lineHeightLG,
        marginBottom: 8,
    },
}))

const DeployVariantModal = ({
    environments,
    selectedVariant,
    loadEnvironments,
    ...props
}: DeployVariantModalProps) => {
    const {token} = useToken()
    const classes = useStyles()
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [isPublishing, setIsPublishing] = useState(false)

    const publishVariants = async () => {
        setIsPublishing(true)
        try {
            for (const envName of selectedRowKeys) {
                try {
                    await createPublishVariant(selectedVariant.variantId, envName as string)
                    props.onCancel?.({} as any)
                    message.success(`Published ${selectedVariant.variantName} to ${envName}`)
                } catch (error) {
                    message.error(`Failed to publish ${selectedVariant.variantName} to ${envName}`)
                    console.error(error)
                }
            }
        } finally {
            await loadEnvironments()
            setIsPublishing(false)
        }
    }

    const columns: ColumnsType<Environment> = [
        {
            title: "Environment",
            dataIndex: "name",
            key: "name",
            render(_, record) {
                return <Typography.Text className="capitalize">{record.name}</Typography.Text>
            },
        },
        {
            title: "Current Deployment",
            dataIndex: "deployed_variant_name",
            key: "deployed_variant_name",
            render(_, record) {
                return record.deployed_variant_name ? (
                    <Tag>
                        <Badge color={token.colorPrimary} text={record.deployed_variant_name} />
                    </Tag>
                ) : (
                    <Tag>No deployment</Tag>
                )
            },
        },
    ]

    return (
        <Modal
            className={classes.container}
            centered
            destroyOnClose
            okText={
                <div className="flex gap-2 items-center">
                    <Rocket size={16} />
                    Deploy
                </div>
            }
            onOk={() => publishVariants()}
            okButtonProps={{loading: isPublishing}}
            {...props}
            title={<Typography.Text className={classes.title}>Deploy Variant</Typography.Text>}
        >
            <div className="flex flex-col gap-4">
                <Typography.Text>
                    Select an environment to deploy{" "}
                    <span className="font-semibold">{selectedVariant.variantName}</span>
                </Typography.Text>

                <Table
                    rowSelection={{
                        type: "checkbox",
                        onChange: (selectedRowKeys: React.Key[]) => {
                            setSelectedRowKeys(selectedRowKeys)
                        },
                    }}
                    columns={columns}
                    dataSource={environments}
                    pagination={false}
                    rowKey={"name"}
                />
            </div>
        </Modal>
    )
}

export default DeployVariantModal
