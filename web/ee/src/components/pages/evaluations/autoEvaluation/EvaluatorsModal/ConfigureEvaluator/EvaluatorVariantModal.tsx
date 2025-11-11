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
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import VariantsTable from "@/oss/components/VariantsComponents/Table"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {JSSTheme, Variant as BaseVariant} from "@/oss/lib/Types"
import {revisionMapAtom} from "@/oss/state/variant/atoms/fetcher"

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

    // Build a list of latest revisions (EnhancedVariant) for each base variant
    const revisionMap = useAtomValue(revisionMapAtom)
    const latestRevisions: EnhancedVariant[] = useMemo(() => {
        const list: EnhancedVariant[] = []
        ;(variants || []).forEach((v) => {
            const arr = revisionMap[v.variantId] || []
            if (arr && arr.length > 0) list.push(arr[0])
        })
        return list
    }, [variants, revisionMap])

    // Clear selection when modal is opened
    useEffect(() => {
        if (props.open) {
            // Preselect currently selected variant's latest revision id
            const rev = latestRevisions.find((r) => r.variantId === selectedVariant?.variantId)
            setSelectedRowKeys(rev?.id ? [rev.id] : [])
        }
    }, [props.open, selectedVariant?.variantId, latestRevisions])

    const filtered = useMemo(() => {
        const src = latestRevisions
        if (!searchTerm) return src
        return (src || []).filter((item) =>
            (item.variantName || "").toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, latestRevisions])

    const loadVariant = useCallback(() => {
        const selectedRevision = filtered?.find((rev) => rev.id === selectedRowKeys[0])
        if (selectedRevision) {
            // Find the base variant matching this revision and pass it back
            const base = (variants || []).find((v) => v.variantId === selectedRevision.variantId)
            if (base) setSelectedVariant(base)
            props.onCancel?.({} as any)
        }
    }, [filtered, selectedRowKeys, setSelectedVariant, props, variants])

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
                    // Use revision id for table and selection, so the cell renderers resolve correctly
                    rowKey={"id"}
                    // Use stable name display to avoid showing Draft tag in selection UI
                    showStableName
                    className={classes.table}
                    showActionsDropdown={false}
                />
            </div>
        </Modal>
    )
}

export default EvaluatorVariantModal
