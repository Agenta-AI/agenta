import { loadAppEvaluations } from "@/lib/services/api";
import { Button, Table } from "antd";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ColumnsType } from 'antd/es/table';
import { Variant } from "@/lib/Types";

interface DataType {
    id: string;
    variants: string[];
    dataset: {
        _id: string;
        name: string;
    }
    // votesData: {
    //     variants_votes_data: {
    //         number_of_votes: number,
    //         percentage: number
    //     },
    //     flag_votes: { number_of_votes: number, percentage: number },
    // }
    created_at: string;
}

export default function EvaluationsList() {
    const router = useRouter();
    const [evaluationsList, setEvaluationsList] = useState<[]>([]);

    const app_name = router.query.app_name?.toString() || "";

    useEffect(() => {
        if (!app_name) {
            return;
        }
        const fetchAppEvaluations = async () => {
            try {
                const result = await loadAppEvaluations(app_name);
                setEvaluationsList(result);
                // setLoading(false);
            } catch (error) {
                console.log(error)
                // setError(error);
            }
        };

        fetchAppEvaluations();
    }, [app_name]);

    const onCompleteEvaluation = (appEvaluation: any ) => { // TODO: improve type
        router.push(`/apps/${app_name}/evaluations/${appEvaluation.id}/`);
    }

    const columns: ColumnsType<DataType> = [
        {
            title: 'Evaluation',
            render: (value: any, record: DataType, index: number) => {
                return (
                    <span>{index+1}</span>
                )
            }
        },
        {
            title: 'Dataset',
            dataIndex: 'datasetName',
            key: 'datasetName',
            render: (value: any, record: DataType, index: number) => {
                return (
                    <span>{record.dataset.name}</span>
                )
            }
        },
        // {
        //     title: 'Variants votes results',
        //     dataIndex: 'votesData',
        //     key: 'votesData',
        //     width: '70%',
        //     render: (value: any, record: DataType, index: number) => {
        //         const variants = data[index].variants;

        //         if (!variants || !record.votesData) return null;

        //         return renderVotesPlot(record.votesData, variants, index, record);
        //     },
        // },
        {
            title: 'Variants',
            dataIndex: 'variants',
            key: 'variants',
            render: (value: any, record: DataType, index: number) => {
                // const variants = evaluationsList[index].variants;
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
            title: 'Created at',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: '300',
        },
        {
            title: 'Action',
            dataIndex: 'action',
            key: 'action',
            render: (value: any, record: DataType, index: number) => {
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

    return (
        <div>
            <Table
                columns={columns}
                dataSource={evaluationsList}
            // loading={loading}
            />
        </div>
    );
}
