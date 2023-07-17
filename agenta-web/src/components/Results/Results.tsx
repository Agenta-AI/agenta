
import { useState, useEffect } from 'react';
import { Table, Spin, Tag, Progress } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { formatDate } from '@/lib/helpers/dateTimeHelper';
import { AppEvaluationResponseType } from '@/lib/Types';
import { useRouter } from 'next/router';
import { EvaluationType } from '@/lib/enums';

interface DataType {
    id: string;
    variants: string[];
    votesData?: {
        variants_votes_data: {
            number_of_votes: number,
            percentage: number
        },
        flag_votes: { number_of_votes: number, percentage: number },
    }
    scoresData?: any;
    evaluationType: EvaluationType;
    createdAt?: string;
}


interface Vote {
    [key: string]: number;
}

const fetchData = async (url: string): Promise<any> => {
    const response = await fetch(url);
    return response.json();
}

const renderVotesPlot = (votesData: any, variants: string[], index: number, record: DataType) => {
    const hexColors = ['#5B8FF9', '#61DDAA', '#FFbcb8'];

    let flagDiv = null;
    if (record.votesData.flag_votes.number_of_votes > 0) {
        flagDiv = <div
            key={`flag-${index}`}
            style={{
                width: `${record.votesData.flag_votes.percentage * 100}%`,
                backgroundColor: hexColors[hexColors.length - 1],
                textAlign: 'center',
                padding: '2px 10px',
            }}
        >{`Flag: ${record.votesData.flag_votes.number_of_votes} votes (${record.votesData.flag_votes.percentage}%)`}</div>
    }

    return <div style={{
        display: 'flex',
        maxHeight: '50px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
    }}>
        {variants.map((cell, index) => {

            const variantsVotesData = votesData.variants_votes_data[cell];
            if (!variantsVotesData || variantsVotesData.number_of_votes === 0) return null;
            return <div
                key={`variant-${index}`}
                style={{
                    padding: '2px 10px',
                    color: '#fff',
                    width: `${variantsVotesData.percentage * 100}%`,
                    backgroundColor: hexColors[index],
                    textAlign: 'center',
                }}
            >
                {`${cell} : ${variantsVotesData.number_of_votes} votes (${variantsVotesData.percentage}%)`}
            </div>
        })}
        {flagDiv}
    </div>
}

const renderScoresPlot = (scoresData: any, variants: string[], index: number, record: DataType) => {
    const hexColors = ['#5B8FF9', '#61DDAA', '#FFbcb8'];

    return <div style={{
        display: 'flex',
        maxHeight: '50px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
    }}>
        <div
            key={`variant-${index}`}
            style={{
                padding: '2px 10px',
                color: '#fff',
                width: `${(scoresData.scores.correct/scoresData.nb_of_rows) * 100}%`,
                backgroundColor: '#cf1322',
                textAlign: 'center',
            }}
        >
            Wrong Answers
        </div>

        <div
            key={`variant-${index}`}
            style={{
                padding: '2px 10px',
                color: '#fff',
                width: `${(scoresData.scores.wrong/scoresData.nb_of_rows) * 100}%`,
                backgroundColor: '#3f8600',
                textAlign: 'center',
            }}
        >
            Correct Answers
        </div>
    </div>
}

const Results: React.FC = () => {
    const router = useRouter();
    const [data, setData] = useState<DataType[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    const appName = router.query.app_name?.toString() || "";

    useEffect(() => {
        // TODO: move to api.ts
        setLoading(true);
        fetchData(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_evaluations?app_name=${appName}`)
            .then(responseData => {

                const fetchPromises: Promise<DataType>[] = responseData.map((item: AppEvaluationResponseType) => {
                    return fetchData(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_evaluations/${item.id}/results`)
                        .then(results => {
                            if (item.evaluation_type === EvaluationType.human_a_b_testing) {
                                if (Object.keys(results.votes_data).length > 0) {
                                    return {
                                        id: item.id,
                                        createdAt: formatDate(item.created_at),
                                        variants: item.variants,
                                        votesData: results.votes_data,
                                        evaluationType: item.evaluation_type,
                                    }
                                }
                            } else if (item.evaluation_type == EvaluationType.auto_exact_match) {
                                if (Object.keys(results.scores_data).length > 0) {
                                    return {
                                        id: item.id,
                                        createdAt: formatDate(item.created_at),
                                        variants: item.variants,
                                        scoresData: results.scores_data,
                                        evaluationType: item.evaluation_type,
                                    }
                                }
                            }
                        })
                        .catch(err => {
                            console.error(err);
                        });
                })

                Promise.all(fetchPromises)
                    .then(appEvaluations => {
                        // Filter out any appEvaluations that are undefined due to not having votes data
                        const validAppEvaluations = appEvaluations.filter(appEvaluation => appEvaluation !== undefined);
                        setData(validAppEvaluations);
                        setLoading(false);
                    })
                    .catch(err => {
                        console.error(err);
                        setLoading(false);
                    });
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, [appName]);

    const columns: ColumnsType<DataType> = [
        {
            title: 'Variants votes results',
            dataIndex: 'votesData',
            key: 'votesData',
            width: '70%',
            render: (value: any, record: DataType, index: number) => {
                const variants = data[index].variants;
                if (data[index].evaluationType == EvaluationType.human_a_b_testing) {
                    return renderVotesPlot(record.votesData, variants, index, record);
                } else if (data[index].evaluationType == EvaluationType.auto_exact_match) {
                    return renderScoresPlot(record.scoresData, variants, index, record);
                }
            },
        },
        {
            title: 'Created at',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: '300',
        },
    ];

    return (
        <div>
            {loading ? (
                <Spin />
            ) : (
                <Table
                    columns={columns}
                    dataSource={data}
                    loading={loading}
                />
            )}
        </div>
    );
};
export default Results;
