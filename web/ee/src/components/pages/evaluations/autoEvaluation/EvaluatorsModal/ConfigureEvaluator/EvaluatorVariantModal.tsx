import {
    useCallback,
    useMemo,
    useState,
    useEffect,
    type ComponentProps,
    type Dispatch,
    type SetStateAction,
    type Key,
} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Play} from "@phosphor-icons/react"
import {Button, Input, Modal, Typography} from "antd"
import {createUseStyles} from "react-jss"

import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {JSSTheme, Variant as BaseVariant} from "@/oss/lib/Types"

type Variant = BaseVariant & {id?: string}
type EvaluatorVariantModalProps = {
    variants: Variant[] | null
    setSelectedVariant: Dispatch<SetStateAction<Variant | null>>
    selectedVariant: Variant | null
} & ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightStrong,
    },
    container: {
        "& .ant-modal-body": {
            height: 600,
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

const EvaluatorVariantModal = ({
    variants,
    setSelectedVariant,
    selectedVariant,
    ...props
}: EvaluatorVariantModalProps) => {
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

    // Clear selection when modal is opened
    useEffect(() => {
        if (props.open) {
            const newKey = selectedVariant?.variantId ?? null
            setSelectedRowKeys(newKey ? [newKey] : [])
        }
    }, [props.open, selectedVariant])

    const filtered = useMemo(() => {
        if (!searchTerm) return variants
        if (variants) {
            return variants.filter((item) =>
                item.variantName.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }
    }, [searchTerm, variants])

    const loadVariant = useCallback(() => {
        const selectedVariant = filtered?.find(
            (variant) => variant.variantId === selectedRowKeys[0],
        )

        if (selectedVariant) {
            setSelectedVariant(selectedVariant)
            props.onCancel?.({} as any)
        }
    }, [filtered, selectedRowKeys, setSelectedVariant, props])

    return (
        <Modal
            closeIcon={null}
            width={1150}
            className={classes.container}
            okText="Load variant"
            okButtonProps={{
                icon: <Play />,
                iconPosition: "end",
                disabled: !selectedRowKeys.length,
                onClick: loadVariant,
            }}
            title={
                <div className="flex items-center justify-between">
                    <Typography.Text className={classes.title}>
                        Select variant to run
                    </Typography.Text>
                    <Button
                        onClick={() => props.onCancel?.({} as any)}
                        type="text"
                        icon={<CloseOutlined />}
                    />
                </div>
            }
            centered
            {...props}
        >
            <div className="flex flex-col gap-4 flex-1 mt-4">
                <Input.Search
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search"
                    allowClear
                    className="w-[240px]"
                />

                <VariantsTable
                    variants={(filtered as any) || []}
                    rowSelection={{
                        selectedRowKeys,
                        onChange: (value) => setSelectedRowKeys(value),
                        type: "radio",
                    }}
                    isLoading={false}
                    onRowClick={() => {}}
                    rowKey={"variantId"}
                    className={classes.table}
                    showActionsDropdown={false}
                />
            </div>
        </Modal>
    )
}

export default EvaluatorVariantModal
