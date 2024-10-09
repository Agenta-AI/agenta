import {Button, Table, Space, message} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"
import {ColumnsType} from "antd/es/table"
import {useState} from "react"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {DeleteOutlined} from "@ant-design/icons"
import {deleteTestsets, useLoadTestsetsList} from "@/services/testsets/api"
import {createUseStyles} from "react-jss"
import {testset} from "@/lib/Types"
import {checkIfResourceValidForDeletion} from "@/lib/helpers/evaluate"
import {useAppsData} from "@/contexts/app.context"
import {useUpdateEffect} from "usehooks-ts"

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
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
})

export default function Testsets() {
    const classes = useStyles()
    const router = useRouter()
    const {apps, isLoading: isAppsLoading} = useAppsData()
    const appId = apps[0]?.app_id
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const {testsets, isTestsetsLoading, mutate} = useLoadTestsetsList(appId)

    useUpdateEffect(() => {
        if ((apps.length === 0 || !apps) && !isAppsLoading) {
            message.warning("To view the test set, you first need to create an app.")
            router.push("/apps")
        }
    }, [isAppsLoading])

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
            if (
                !(await checkIfResourceValidForDeletion({
                    resourceType: "testset",
                    resourceIds: testsetsIds,
                }))
            )
                return

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
                        <Link data-cy="testset-new-upload-link" href={`/apps/testsets/new/upload`}>
                            <Button type="primary">Upload Test Set</Button>
                        </Link>
                        <Link data-cy="testset-new-manual-link" href={`/apps/testsets/new/manual`}>
                            <Button>Create Test Set in UI</Button>
                        </Link>
                        <Link data-cy="testset-new-api-link" href={`/apps/testsets/new/api`}>
                            <Button>Create a test set with API</Button>
                        </Link>
                    </div>

                    {testsets.length > 0 && (
                        <Space className={classes.startLink}>
                            <Link
                                href={`/apps/${appId}/evaluations?selectedEvaluation=auto_evaluation`}
                            >
                                <Button>Start an Automatic Evaluation</Button>
                            </Link>

                            <Link
                                href={`/apps/${appId}/evaluations?selectedEvaluation=human_ab_testing`}
                            >
                                <Button>Start a Human Evaluation</Button>
                            </Link>
                        </Space>
                    )}
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
                    loading={isTestsetsLoading || isAppsLoading}
                    onRow={(record) => {
                        return {
                            onClick: () => router.push(`/apps/testsets/${record._id}`),
                        }
                    }}
                />
            </div>
        </div>
    )
}
