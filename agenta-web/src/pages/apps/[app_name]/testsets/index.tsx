import {Button, Dropdown, MenuProps, Space, Spin, Table} from "antd"

import {testset} from "@/lib/Types"
import Link from "next/link"
import {useRouter} from "next/router"
import {ColumnsType} from "antd/es/table"
import {useState, useEffect} from "react"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {DeleteOutlined} from "@ant-design/icons"
import {deleteTestsets} from "@/lib/services/api"

type testsetTableDatatype = {
    key: string
    created_at: string
    name: string
}

const fetchData = async (url: string): Promise<any> => {
    const response = await fetch(url)
    return response.json()
}

export default function testsets() {
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
        fetchData(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets?app_name=${app_name}`)
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
        },
        {
            title: "Creation date",
            dataIndex: "created_at",
            key: "created_at",
            render: (date: string) => {
                return formatDate(date)
            },
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
            <div style={{marginTop: 20, marginBottom: 40}}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "20px",
                    }}
                >
                    <div style={{display: "flex", gap: "10px"}}>
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
                        <Link
                            data-cy="testset-new-api-link"
                            href={`/apps/${app_name}/testsets/new/api`}
                        >
                            <Button>Create a test set with API</Button>
                        </Link>
                    </div>

                    <Link href={`/apps/${app_name}/evaluations`} style={{marginLeft: 10}}>
                        <Button>Start an evaluation</Button>
                    </Link>
                </div>

                {selectedRowKeys.length > 0 && (
                    <Button
                        data-cy="app-testset-delete-button"
                        style={{marginTop: 30}}
                        onClick={onDelete}
                    >
                        <DeleteOutlined key="delete" style={{color: "red"}} />
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
