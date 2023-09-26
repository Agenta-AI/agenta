import {Button, Tooltip, Spin, Table} from "antd"

import {testset} from "@/lib/Types"
import Link from "next/link"
import {useRouter} from "next/router"
import {ColumnsType} from "antd/es/table"
import {useState, useEffect} from "react"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {DeleteOutlined} from "@ant-design/icons"
import {deleteTestsets} from "@/lib/services/api"
import axios from "@/lib/helpers/axiosConfig"
import {createUseStyles} from "react-jss"
import {isDemo} from "@/constants/environment"

type testsetTableDatatype = {
    key: string
    created_at: string
    name: string
}

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

const fetchData = async (url: string): Promise<any> => {
    const response = await axios.get(url)
    return response.data
}

export default function Testsets() {
    const classes = useStyles()
    const router = useRouter()
    const {app_name} = router.query
    const [testsetsList, setTestsetsList] = useState<testsetTableDatatype[]>([])
    const [loading, setLoading] = useState<boolean>(true)
    const [selectionType, setSelectionType] = useState<"checkbox" | "radio">("checkbox")
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    useEffect(() => {
        if (!app_name) {
            return
        }
        // TODO: move to api.ts
        fetchData(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/?app_name=${app_name}`)
            .then((data) => {
                let newTestsetsList = data.map((obj: testset) => {
                    let newObj: testsetTableDatatype = {
                        key: obj._id,
                        created_at: obj.created_at,
                        name: obj.name,
                    }
                    return newObj
                })
                setLoading(false)
                setTestsetsList(newTestsetsList)
            })
            .catch((error) => {
                console.log(error)
            })
    }, [app_name])

    const columns: ColumnsType<testsetTableDatatype> = [
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
        onChange: (selectedRowKeys: React.Key[], selectedRows: testsetTableDatatype[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const onDelete = async () => {
        const testsetsIds = selectedRowKeys.map((key) => key.toString())
        setLoading(true)
        try {
            const deletedIds = await deleteTestsets(testsetsIds)
            setTestsetsList((prevTestsetsList) =>
                prevTestsetsList.filter((testset) => !deletedIds.includes(testset.key)),
            )

            setSelectedRowKeys([])
        } catch (e) {
            console.log(e)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div>
            <div className={classes.container}>
                <div className={classes.btnContainer}>
                    <div className={classes.linksContainer}>
                        <Link
                            data-cy="testset-new-upload-link"
                            href={`/apps/${app_name}/testsets/new/upload`}
                        >
                            <Button>Upload a test set</Button>
                        </Link>
                        <Link
                            data-cy="testset-new-manual-link"
                            href={`/apps/${app_name}/testsets/new/manual`}
                        >
                            <Button>Create a test set with UI</Button>
                        </Link>
                        {isDemo ? (
                            <Tooltip title="API test set creation is unavailable in the demo version. Check out the self-hosted open-source version at https://github.com/agenta-ai/agenta">
                                <Button disabled>Create a test set with API</Button>
                            </Tooltip>
                        ) : (
                            <Link
                                data-cy="testset-new-api-link"
                                href={`/apps/${app_name}/testsets/new/api`}
                            >
                                <Button>Create a test set with API</Button>
                            </Link>
                        )}
                        <Link href={`/apps/${app_name}/testsets/new/endpoint`}>
                            <Button>Import from Endpoint</Button>
                        </Link>
                    </div>

                    <Link href={`/apps/${app_name}/evaluations`} className={classes.startLink}>
                        {testsetsList.length > 0 && <Button>Start an evaluation</Button>}
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
                {loading ? (
                    <Spin />
                ) : (
                    <Table
                        data-cy="app-testset-list"
                        rowSelection={{
                            type: selectionType,
                            ...rowSelection,
                        }}
                        columns={columns}
                        dataSource={testsetsList}
                        loading={loading}
                        onRow={(record, rowIndex) => {
                            return {
                                onClick: () =>
                                    router.push(`/apps/${app_name}/testsets/${record.key}`),
                            }
                        }}
                    />
                )}
            </div>
        </div>
    )
}
