import {Button, Tooltip, Spin, Table} from "antd"

import Link from "next/link"
import {useRouter} from "next/router"
import {ColumnsType} from "antd/es/table"
import {useState} from "react"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {DeleteOutlined} from "@ant-design/icons"
import {deleteTestsets, useLoadTestsetsList} from "@/lib/services/api"
import {createUseStyles} from "react-jss"
import {testset} from "@/lib/Types"
import {isDemo} from "@/lib/helpers/utils"

const useStyles = createUseStyles({
    container: {
        marginTop: 20,
        marginBottom: 40,
    },
    btnContainer: {
        display: "flex",
        justifyContent: "space-between",
        marginTop: "20px",
    },
    deleteBtn: {
        marginTop: "30px",
        "& svg": {
            color: "red",
        },
    },
    linksContainer: {
        display: "flex",
        gap: "10px",
        flexWrap: "wrap",
    },
    startLink: {
        marginLeft: 10,
    },
})

export default function Testsets() {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const {testsets, isTestsetsLoading, mutate} = useLoadTestsetsList(appId)

    const columns: ColumnsType<testset> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            className: "testset-column",
        },
        {
            title: "Creation date",
            dataIndex: "created_at",
            key: "created_at",
            render: (date: string) => {
                return formatDate(date)
            },
            className: "testset-column",
        },
    ]

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const onDelete = async () => {
        const testsetsIds = selectedRowKeys.map((key) => key.toString())
        try {
            await deleteTestsets(testsetsIds)
            mutate()
            setSelectedRowKeys([])
        } catch {}
    }

    return (
        <div>
            <div className={classes.container}>
                <div className={classes.btnContainer}>
                    <div className={classes.linksContainer}>
                        <Link
                            data-cy="testset-new-upload-link"
                            href={`/apps/${appId}/testsets/new/upload`}
                        >
                            <Button>Upload a test set</Button>
                        </Link>
                        <Link
                            data-cy="testset-new-manual-link"
                            href={`/apps/${appId}/testsets/new/manual`}
                        >
                            <Button>Create a test set with UI</Button>
                        </Link>
                        {isDemo() ? (
                            <Tooltip title="API test set creation is unavailable in the demo version. Check out the self-hosted open-source version at https://github.com/agenta-ai/agenta">
                                <Button disabled>Create a test set with API</Button>
                            </Tooltip>
                        ) : (
                            <Link
                                data-cy="testset-new-api-link"
                                href={`/apps/${appId}/testsets/new/api`}
                            >
                                <Button>Create a test set with API</Button>
                            </Link>
                        )}
                        <Link href={`/apps/${appId}/testsets/new/endpoint`}>
                            <Button>Import from Endpoint</Button>
                        </Link>
                    </div>

                    <Link href={`/apps/${appId}/evaluations`} className={classes.startLink}>
                        {testsets.length > 0 && <Button>Start an evaluation</Button>}
                    </Link>
                </div>

                {selectedRowKeys.length > 0 && (
                    <Button
                        data-cy="app-testset-delete-button"
                        onClick={onDelete}
                        className={classes.deleteBtn}
                    >
                        <DeleteOutlined key="delete" />
                        Delete
                    </Button>
                )}
            </div>

            <div>
                <Table
                    data-cy="app-testset-list"
                    rowSelection={{
                        type: "checkbox",
                        ...rowSelection,
                    }}
                    columns={columns}
                    dataSource={testsets}
                    rowKey="_id"
                    loading={isTestsetsLoading}
                    onRow={(record) => {
                        return {
                            onClick: () => router.push(`/apps/${appId}/testsets/${record._id}`),
                        }
                    }}
                />
            </div>
        </div>
    )
}
