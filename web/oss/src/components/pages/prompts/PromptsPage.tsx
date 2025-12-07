import {useMemo, useState} from "react"

import {Breadcrumb, Button, Dropdown, Input, Space, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {createUseStyles} from "react-jss"
import useSWR from "swr"

import {
    FolderDashedIcon,
    FolderSimpleIcon,
    GearSixIcon,
    NoteIcon,
    PencilSimpleIcon,
    PlusIcon,
    TrashIcon,
} from "@phosphor-icons/react"

import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {JSSTheme} from "@/oss/lib/Types"
import {useProjectData} from "@/oss/state/project"
import {queryFolders} from "@/oss/services/folders"
import PromptsBreadcrumb from "./components/PromptsBreadcrumb"
import {buildFolderTree, FolderTreeNode} from "./assets/utils"
import {MoreOutlined} from "@ant-design/icons"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {},
}))

const PromptsPage = () => {
    const classes = useStyles()
    const {project, projectId} = useProjectData()
    const [searchTerm, setSearchTerm] = useState("")
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)

    useBreadcrumbsEffect({breadcrumbs: {prompts: {label: "prompts"}}}, [])

    const {data: foldersData, isLoading} = useSWR(projectId ? ["folders", projectId] : null, () =>
        queryFolders({folder: {}}),
    )

    const {roots, foldersById} = useMemo(() => {
        const folders = foldersData?.folders ?? []
        return buildFolderTree(folders)
    }, [foldersData])

    // what we show in the table
    const visibleRows: FolderTreeNode[] = useMemo(() => {
        if (!currentFolderId) return roots
        const current = foldersById[currentFolderId]
        return current?.children ?? roots
    }, [currentFolderId, roots, foldersById])

    console.log("visibleRows: ", visibleRows)

    const handleRowClick = (record: FolderTreeNode) => {
        // only drill into folders; later you’ll have non-folder rows
        setCurrentFolderId(record.id as string | null)
    }

    const handleBreadcrumbFolderChange = (folderId: string | null) => {
        setCurrentFolderId(folderId)
    }

    const columns: ColumnsType<FolderTreeNode> = [
        {
            title: "Name",
            dataIndex: "name",
            render: (name, record) => <span>{name}</span>,
        },
        {
            title: "Date modified",
            key: "dateModified",
            render: (_, record) => {
                return <div>{formatDay({date: record.updated_at})}</div>
            },
        },
        {
            title: "Type",
            key: "type",
        },
        {
            title: <GearSixIcon size={16} />,
            key: "actions",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "open_folder",
                                    label: "Open",
                                    icon: <NoteIcon size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                    },
                                },
                                {
                                    key: "rename_folder",
                                    label: "Rename",
                                    icon: <PencilSimpleIcon size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                    },
                                },
                                {
                                    key: "move_folder",
                                    label: "Move",
                                    icon: <FolderDashedIcon size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                    },
                                },
                                {
                                    type: "divider",
                                },
                                {
                                    key: "delete_folder",
                                    label: "Delete",
                                    icon: <TrashIcon size={16} />,
                                    danger: true,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            onClick={(e) => e.stopPropagation()}
                            icon={<MoreOutlined />}
                            size="small"
                        />
                    </Dropdown>
                )
            },
        },
    ]

    return (
        <div className="flex flex-col gap-4">
            <Title className="!m-0" level={2}>
                Prompts
            </Title>

            <PromptsBreadcrumb
                foldersById={foldersById}
                currentFolderId={currentFolderId}
                onFolderChange={handleBreadcrumbFolderChange}
            />

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Space>
                        <Input.Search
                            placeholder="Search"
                            allowClear
                            className="w-[400px]"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                        />
                    </Space>

                    <Space>
                        <Button icon={<TrashIcon />} danger>
                            Delete
                        </Button>
                        <Button icon={<PlusIcon />} type="primary">
                            Create new
                        </Button>
                    </Space>
                </div>

                <Table<FolderTreeNode>
                    rowSelection={{type: "checkbox"}}
                    columns={columns}
                    dataSource={visibleRows}
                    loading={isLoading}
                    pagination={false}
                    bordered
                    rowKey="id"
                    onRow={(record) => ({
                        onClick: () => handleRowClick(record as any),
                        className: "cursor-pointer",
                    })}
                />
            </div>
        </div>
    )
}

export default PromptsPage
