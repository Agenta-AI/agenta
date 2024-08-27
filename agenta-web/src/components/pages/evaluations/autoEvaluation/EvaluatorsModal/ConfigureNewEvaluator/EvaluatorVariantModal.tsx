import {formatVariantIdWithHash} from "@/lib/helpers/utils"
import {JSSTheme, Variant} from "@/lib/Types"
import {CloseOutlined} from "@ant-design/icons"
import {Badge, Button, Divider, Input, Modal, Table, Tag, theme, Typography} from "antd"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

type EvaluatorVariantModalProps = {
    variants: Variant[] | null
} & React.ComponentProps<typeof Modal>

const {useToken} = theme

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightStrong,
    },
    container: {
        "& .ant-modal-content": {
            paddingLeft: 0,
            paddingRight: 0,
        },
        "& .ant-modal-body": {
            paddingLeft: 24,
            paddingRight: 24,
            height: 300,
            overflowY: "auto",
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

const EvaluatorVariantModal = ({variants, ...props}: EvaluatorVariantModalProps) => {
    const classes = useStyles()
    const {token} = useToken()
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedVariant, setSelectedVariant] = useState<Variant>()

    const filtered = useMemo(() => {
        if (!searchTerm) return variants
        if (variants) {
            return variants.filter((item) =>
                item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
    }, [searchTerm, variants])

    return (
        <Modal
            closeIcon={null}
            className={classes.container}
            title={
                <>
                    <div className="flex flex-col gap-4 px-6">
                        <div className="flex items-center justify-between">
                            <Typography.Text className={classes.title}>
                                Select variant
                            </Typography.Text>
                            <Button
                                onClick={() => props.onCancel?.({} as any)}
                                type="text"
                                icon={<CloseOutlined />}
                            />
                        </div>

                        <Input.Search
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search"
                            allowClear
                        />
                    </div>
                    <Divider className="mb-0" />
                </>
            }
            centered
            footer={null}
            {...props}
        >
            <Table
                bordered
                pagination={false}
                dataSource={filtered?.length ? filtered : undefined}
                columns={[
                    {
                        title: "Variants",
                        dataIndex: "variantName",
                        key: "variantName",
                        render: (_, record) => {
                            return (
                                <div className="flex items-center justify-between">
                                    <div>{record.variantName}</div>

                                    <Tag>
                                        <Badge
                                            color={token.colorPrimary}
                                            text={formatVariantIdWithHash(record.variantId)}
                                        />
                                    </Tag>
                                </div>
                            )
                        },
                    },
                ]}
                onRow={(record) => ({
                    onClick: () => {
                        setSelectedVariant(record)
                    },
                    style: {cursor: "pointer"},
                })}
                className={classes.table}
                scroll={{y: 300}}
                style={{height: 330}}
            />
        </Modal>
    )
}

export default EvaluatorVariantModal
