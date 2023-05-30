
import { useState, useEffect } from 'react';
import { Table, Spin, Tag, Progress } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { formatDate } from '@/lib/helpers/dateTimeHelper';

interface DataType {
    id: string;
    variants: string[];
    votesData: {
        variants_votes_data: {
            number_of_votes: number,
            percentage: number
        },
        flag_votes: { number_of_votes: number, percentage: number },
    }
    createdAt?: string;
}

interface ResponseType {
    id: string;
    variants: string[];
    votes_data: {
        variants_votes_data: {
            number_of_votes: number,
            percentage: number
        },
        flag_votes: { number_of_votes: number, percentage: number },
    }
    created_at: string;
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

const Results: React.FC = () => {

    const [data, setData] = useState<DataType[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [statsLoading, setStatsLoading] = useState<boolean[]>([]);

    useEffect(() => {
        fetchData('http://localhost/api/app_evaluations')
            .then(responseData => {
                const initialData: DataType[] = responseData.map((item: ResponseType) => {
                    return {
                        id: item.id,
                        createdAt: formatDate(item.created_at),
                        variants: item.variants,
                        votesData: null,
                    }
                })

                setData(initialData);
                setLoading(false);

                initialData.forEach((item, index) => {
                    fetchData(`http://localhost/api/app_evaluations/${item.id}/votes_data`)
                        .then(results => {
                            setData(prevData => {
                                const newData = [...prevData];
                                newData[index].votesData = results.votes_data;
                                return newData;
                            });

                            setStatsLoading(prevStatsLoading => {
                                const newStatsLoading = [...prevStatsLoading];
                                newStatsLoading[index] = false;
                                return newStatsLoading;
                            });
                        })
                        .catch(err => {
                            console.error(err);
                        });
                });
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const columns: ColumnsType<DataType> = [
        {
            title: 'Variants votes results',
            dataIndex: 'votesData',
            key: 'votesData',
            width: '70%',
            render: (value: any, record: DataType, index: number) => {
                const variants = data[index].variants;

                if (!variants || !record.votesData) return null;

                return renderVotesPlot(record.votesData, variants, index, record);
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





  // const modelData = [
  //     {
  //         key: '1',
  //         model: 'Model A',
  //         score: 70,
  //         confidence: '65% - 75%',
  //     },
  //     {
  //         key: '2',
  //         model: 'Model B',
  //         score: 60,
  //         confidence: '55% - 65%',
  //     },
  //     {
  //         key: '3',
  //         model: 'Model C',
  //         score: 80,
  //         confidence: '75% - 85%',
  //     },
  // ];

  // const recentComparisons = [
  //     {
  //         key: '1',
  //         model: 'Model A',
  //         score: 70,
  //         confidence: '65% - 75%',
  //     },
  //     {
  //         key: '2',
  //         model: 'Model B',
  //         score: 60,
  //         confidence: '55% - 65%',
  //     },
  // ];

  // const latencyData = [
  //     {
  //         key: '1',
  //         model: 'Model A',
  //         latency: 200,
  //         cost: 0.5,
  //     },
  //     {
  //         key: '2',
  //         model: 'Model B',
  //         latency: 300,
  //         cost: 0.6,
  //     },
  //     {
  //         key: '3',
  //         model: 'Model C',
  //         latency: 250,
  //         cost: 0.7,
  //     },
  // ];

  // const columns = [
  //     {
  //         title: 'Model',
  //         dataIndex: 'model',
  //         key: 'model',
  //     },
  //     {
  //         title: 'Preference Score',
  //         dataIndex: 'score',
  //         key: 'score',
  //     },
  //     {
  //         title: 'Confidence Interval',
  //         dataIndex: 'confidence',
  //         key: 'confidence',
  //     },
  // ];

  // const latencyColumns = [
  //     {
  //         title: 'Model',
  //         dataIndex: 'model',
  //         key: 'model',
  //     },
  //     {
  //         title: 'Latency (ms)',
  //         dataIndex: 'latency',
  //         key: 'latency',
  //     },
  //     {
  //         title: 'Average Cost ($)',
  //         dataIndex: 'cost',
  //         key: 'cost',
  //     },
  // ];

  // const bestModel = modelData.reduce((prev, current) =>
  //     (prev.score > current.score) ? prev : current
  // );

  // useEffect(() => {
  //     loadResults();
  // }, []);

  // const loadResults = () => {
  //   const fetchResults = async (url = '', data = {}) => {
  //     const response = await fetch(url, {
  //       method: 'POST',
  //       cache: 'no-cache',
  //       credentials: 'same-origin',
  //       headers: {
  //         'Content-Type': 'application/json'
  //       },
  //       redirect: 'follow',
  //       referrerPolicy: 'no-referrer',
  //       body: JSON.stringify(data)
  //     });

  //     return response.json();
  //   };

  // updateData(`http://localhost/api/app_evaluations/${comparisonTableId}/evaluation_row/${evaluation_row_id}`, data)
  //     .then(data => {
  //         // setRowValue(rowIndex, 'vote', vote);
  //     }).catch(err => {
  //         console.error(err);
  //     });


// return (
//     <div>
//         <Card title="Best Model Overview">
//             <p><strong>Model:</strong> {bestModel.model}</p>
//             <p><strong>Preference Score:</strong> {bestModel.score}</p>
//             <p><strong>Confidence Interval:</strong> {bestModel.confidence}</p>
//         </Card>

//         <Table columns={columns} dataSource={modelData} title={() => 'Performance Matrix'} />

//         <Table columns={columns} dataSource={recentComparisons} title={() => 'Recent Comparisons'} />

//         <Table columns={latencyColumns} dataSource={latencyData} title={() => 'Latency and Cost'} />
//     </div>
// );
// };

