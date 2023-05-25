
import { useState, useEffect } from 'react';
import { Table, Spin, Tag } from 'antd';
import { ColumnsType } from 'antd/es/table';


interface DataType {
  id: string;
  variants: [string];
  results: null | { variants: string[]; votes: Array<Record<string, number>>; nb_of_rows: number };
  createdAt?: string;
}

interface ResultsType {
  id: string;
  variants: [string];
  votes: Array<Record<string, number>>;
  created_at: string;
}

interface Vote {
  [key: string]: number;
}

const fetchData = async (url: string): Promise<any> => {
  const response = await fetch(url);
  return response.json();
}

const Results: React.FC = () => {

  const [data, setData] = useState<DataType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statsLoading, setStatsLoading] = useState<boolean[]>([]);

  useEffect(() => {
    fetchData('http://localhost/api/app_evaluations')
      .then(responseData => {
        const initialData: DataType[] = responseData.map((item: ResultsType) => ({
          id: item.id,
          createdAt: item.created_at,
          variants: item.variants,
          results: null,
        }));

        setData(initialData);
        setLoading(false);

        initialData.forEach((item, index) => {
          fetchData(`http://localhost/api/app_evaluations/${item.id}/results`)
            .then(results => {

              setData(prevData => {
                const newData = [...prevData];
                newData[index].results = results.results;
                return newData;
              });

              setStatsLoading(prevStatsLoading => {
                const newStatsLoading = [...prevStatsLoading];
                newStatsLoading[index] = false;
                return newStatsLoading;
              });
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
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
    },
    {
      title: 'Variants',
      dataIndex: 'variants',
      key: 'variants',
      render: (_: any, record: DataType, index: number) => {
        const variants = record.variants;
        if (variants) {
          return <>
            {variants.map((variant, index) => (
              <span style={{ marginRight: "5px" }} key={index}>{variant}</span>
            ))}
          </>
        }
        return null;

      }
    },
    {
      title: 'Results',
      key: 'results',
      render: (_: any, record: DataType, index: number) => {
        if (statsLoading[index]) {
          return <Spin />;
        }
        const results = record.results;

        if (results && results.votes) {

          if(results.votes.length === 1 && Object.keys(results.votes[0])[0] === '0') {
            return <div> No votes </div>;
          }
          const sortedVotes: Vote[] = [...results.votes].sort((a, b) => {
            const keyA = Object.keys(a)[0];
            const keyB = Object.keys(b)[0];

            if (keyA === '0') return 1; // '0' should always come last
            if (keyB === '0') return -1;

            // Regular alphabetical sort for other keys
            return keyA.localeCompare(keyB);
          });

          return sortedVotes.map((vote, i) => {
            const [key, value] = Object.entries(vote)[0];
            if (key === '0') {
              return <Tag color="red" key={i}>Flag: {value}</Tag>
            }
            return <Tag color="green" key={i}>{key}: {value}</Tag>
          });
        }
        return null;
      },
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

