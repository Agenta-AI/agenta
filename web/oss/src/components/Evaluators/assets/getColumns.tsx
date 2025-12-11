import {GearSix} from "@phosphor-icons/react"
import {ColumnsType} from "antd/es/table"
import dynamic from "next/dynamic"

import EvaluatorTagsCell from "./cells/EvaluatorTagsCell"
import EvaluatorTypePill from "./cells/EvaluatorTypePill"
import {EvaluatorRegistryRow, GetColumnsParams} from "./types"

const UserAvatarTag = dynamic(() => import("@/oss/components/CustomUIs/UserAvatarTag"), {
    ssr: false,
    loading: () => <div className="h-6 w-[120px] bg-[#0517290F]"></div>,
})

const TableDropdownMenu = dynamic(() => import("./cells/TableDropdownMenu"), {
    ssr: false,
    loading: () => <div className="h-6 w-6 bg-[#0517290F]"></div>,
})

const getColumns = ({
    category,
    onEdit,
    onConfigure,
    onDelete,
}: GetColumnsParams): ColumnsType<EvaluatorRegistryRow> => {
    const typeColumn = {
        title: "Type",
        dataIndex: "typeBadge",
        key: "type",
        width: 180,
        render: (value: EvaluatorRegistryRow["typeBadge"]) => {
            return <EvaluatorTypePill badge={value} />
        },
    }

    const modifiedByColumn = {
        title: "Modified by",
        dataIndex: "modifiedBy",
        key: "modifiedBy",
        width: 200,
        render: (_: string, record: EvaluatorRegistryRow) => {
            if (!record.modifiedBy) return null
            return <UserAvatarTag modifiedBy={record.modifiedBy as string} />
        },
    }

    const columns: ColumnsType<EvaluatorRegistryRow> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            fixed: "left",
            width: 240,
        },
        {
            title: category === "human" ? "Feedback" : "Tags",
            dataIndex: "tags",
            key: "tags",
            width: 260,
            render: (tags: string[]) => <EvaluatorTagsCell tags={tags} />,
        },
        {
            title: "Date Created",
            dataIndex: "dateCreated",
            key: "dateCreated",
            width: 160,
            render: (value: string) => value || null,
        },
        {
            title: "Last modified",
            dataIndex: "lastModified",
            key: "lastModified",
            width: 160,
            render: (value: string) => value || null,
        },
    ]

    if (category === "human") {
        columns.push(modifiedByColumn)
    }

    if (category !== "human") {
        columns.splice(1, 0, typeColumn)
    }

    columns.push({
        title: <GearSix size={16} />,
        key: "actions",
        width: 56,
        fixed: "right",
        align: "center",
        render: (_: unknown, record: EvaluatorRegistryRow) => (
            <TableDropdownMenu
                record={record}
                category={category}
                onEdit={onEdit}
                onConfigure={onConfigure}
                onDelete={onDelete}
            />
        ),
    })

    return columns
}

export default getColumns
