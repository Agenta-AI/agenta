import { deleteAppEvaluations, loadAppEvaluations } from "@/lib/services/api";
import { Button, Table } from "antd";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ColumnsType } from 'antd/es/table';
import { Variant } from "@/lib/Types";
import { DeleteOutlined } from "@ant-design/icons";
import { EvaluationTypeLabels } from "@/lib/helpers/utils";
import { EvaluationType } from "@/lib/enums";

interface EvaluationListTableDataType {
    key: string;
    variants: string[];
    dataset: {
        _id: string;
        name: string;
    },
    evaluationType: string;
    // votesData: {
    //     variants_votes_data: {
    //         number_of_votes: number,
    //         percentage: number
    //     },
    //     flag_votes: { number_of_votes: number, percentage: number },
    // }
    createdAt: string;
}

export default function EvaluationsList() {
    const router = useRouter();
    const [appEvaluationsList, setAppEvaluationsList] = useState<EvaluationListTableDataType[]>([]);
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
    const [selectionType, setSelectionType] = useState<'checkbox' | 'radio'>('checkbox');
    const [deletingLoading, setDeletingLoading] = useState<boolean>(true);

    const app_name = router.query.app_name?.toString() || "";

    useEffect(() => {
        if (!app_name) {
            return;
        }
        const fetchAppEvaluations = async () => {
            try {
                const result = await loadAppEvaluations(app_name);
                let newList = result
                    .filter((obj: any) =>
                        obj.evaluationType === 'human_a_b_testing' ||
                        obj.evaluationType === 'human_scoring'
                    )
                    .map((obj: any) => {
                        let newObj: EvaluationListTableDataType = {
                            key: obj.id,
                            dataset: obj.dataset,
                            variants: obj.variants,
                            evaluationType: obj.evaluationType,
                            createdAt: obj.createdAt,
                        }
                        return newObj;
                    });
                setAppEvaluationsList(newList);
                setDeletingLoading(false);
            } catch (error) {
                console.log(error)
                // setError(error);
            }
        };

        fetchAppEvaluations();
    }, [app_name]);

    const onCompleteEvaluation = (appEvaluation: any) => { // TODO: improve type
        const evaluationType = EvaluationType[appEvaluation.evaluationType as keyof typeof EvaluationType];

        if (evaluationType === EvaluationType.auto_exact_match) {
            router.push(`/apps/${app_name}/evaluations/${appEvaluation.key}/auto_exact_match`);
        } else if (evaluationType === EvaluationType.human_a_b_testing) {
            router.push(`/apps/${app_name}/evaluations/${appEvaluation.key}/human_a_b_testing`);
        }
    }

    const columns: ColumnsType<EvaluationListTableDataType> = [
        {
            title: 'Evaluation',
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <span>{index + 1}</span>
                )
            }
        },
        {
            title: 'Dataset',
            dataIndex: 'datasetName',
            key: 'datasetName',
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <span>{record.dataset.name}</span>
                )
            }
        },
        {
            title: 'Variants',
            dataIndex: 'variants',
            key: 'variants',
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <div>
                        {value.map((variant: Variant, index: number) => {
                            return <span>
                                <span>{variant.variantName}</span>
                                {
                                    index < value.length - 1 &&
                                    <span> | </span>
                                }
                            </span>
                        })}
                    </div>
                )

            }
        },
        {
            title: 'Evaluation type',
            dataIndex: 'evaluationType',
            key: 'evaluationType',
            width: '300',
            render: (value: string) => {
                const evaluationType = EvaluationType[value as keyof typeof EvaluationType];
                const label = EvaluationTypeLabels[evaluationType];
                return (
                    <span>{label}</span>
                );
            },
        },
        {
            title: 'Created at',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: '300'
        },
        {
            title: 'Action',
            dataIndex: 'action',
            key: 'action',
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <div className="hover-button-wrapper">
                        <Button
                            type="primary"
                            onClick={() => onCompleteEvaluation(record)}
                        >
                            Continue evaluation
                        </Button>
                    </div>
                )
            }
        },
    ];

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[], selectedRows: EvaluationListTableDataType[]) => {
            setSelectedRowKeys(selectedRowKeys);
        }
    };

    const onDelete = async () => {
        const appEvaluationsIds = selectedRowKeys.map(key => key.toString());
        setDeletingLoading(true);
        try {
            const deletedIds = await deleteAppEvaluations(appEvaluationsIds);
            setAppEvaluationsList(prevAppEvaluationsList => prevAppEvaluationsList.filter(appEvaluation => !deletedIds.includes(appEvaluation.key)));

            setSelectedRowKeys([]);
        } catch (e) {
            console.log(e)
        } finally {
            setDeletingLoading(false);
        }
    };

    return (
        <div>

            <div style={{ marginBottom: 40 }}>

                <Button onClick={onDelete} disabled={selectedRowKeys.length == 0}>
                    <DeleteOutlined key="delete" style={{ color: 'red' }} />
                    Delete
                </Button>
            </div>

            <Table
                rowSelection={{
                    type: selectionType,
                    ...rowSelection,
                }}
                columns={columns}
                dataSource={appEvaluationsList}
            // loading={loading}
            />
        </div>
    );
}
