
import { Button, Spin, Table } from "antd";

import { Dataset } from "@/lib/Types";
import Link from "next/link";
import { useRouter } from "next/router";
import { ColumnsType } from 'antd/es/table';
import { useState, useEffect } from 'react';
import { formatDate } from '@/lib/helpers/dateTimeHelper';
import { DeleteOutlined } from "@ant-design/icons";
import { deleteDatasets } from "@/lib/services/api";

type DatasetTableDatatype = {
    key: string;
    created_at: string;
    name: string;
}

const fetchData = async (url: string): Promise<any> => {
    const response = await fetch(url);
    return response.json();
}

export default function Datasets() {
    const router = useRouter();
    const { app_name } = router.query;
    const [datasetsList, setDatasetsList] = useState<DatasetTableDatatype[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [selectionType, setSelectionType] = useState<'checkbox' | 'radio'>('checkbox');
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

    useEffect(() => {
        if (!app_name) {
            return;
        }
        // TODO: move to api.ts
        fetchData(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/datasets?app_name=${app_name}`)
            .then(data => {
                let newDatasetsList = data.map((obj: Dataset) => {

                    let newObj: DatasetTableDatatype = {
                        key: obj._id,
                        created_at: obj.created_at,
                        name: obj.name
                    }
                    return newObj;
                });
                setLoading(false);
                setDatasetsList(newDatasetsList);
            }).
            catch(error => {
                console.log(error);
            });
    }, [app_name]);

    const columns: ColumnsType<DatasetTableDatatype> = [
        {
            title: 'Name',
            dataIndex: 'name',
            key: 'name'
        },
        {
            title: 'Creation date',
            dataIndex: 'created_at',
            key: 'created_at',
            render: (date: string) => {
                return formatDate(date);
            }
        },
    ];

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[], selectedRows: DatasetTableDatatype[]) => {
            setSelectedRowKeys(selectedRowKeys);
        }
    };

    const onDelete = async () => {
        const datasetsIds = selectedRowKeys.map(key => key.toString());
        setLoading(true);
        try {
            const deletedIds = await deleteDatasets(datasetsIds);
            setDatasetsList(prevDatasetsList => prevDatasetsList.filter(dataset => !deletedIds.includes(dataset.key)));

            setSelectedRowKeys([]);
        } catch (e) {
            console.log(e)
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div style={{ marginBottom: 40 }}>
                <Link href={`${router.asPath}/new`}>
                    <Button >Add a test set</Button>
                </Link>

                <Link href={`/apps/${app_name}/evaluations`} style={{ marginLeft: 10 }}>
                    <Button >Start an evaluation</Button>
                </Link>
                {
                    selectedRowKeys.length > 0 && (
                        <Button style={{ marginLeft: 10 }} onClick={onDelete}>
                            <DeleteOutlined key="delete" style={{ color: 'red' }} />
                            Delete
                        </Button>
                    )
                }
            </div>

            <div>
                {loading ? (
                    <Spin />
                ) : (
                    <Table
                        rowSelection={{
                            type: selectionType,
                            ...rowSelection,
                        }}
                        columns={columns}
                        dataSource={datasetsList}
                        loading={loading}
                    />
                )}
            </div>
        </div>
    );
}
