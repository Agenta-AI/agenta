
import { useState, useEffect } from 'react';
import { Table, Card, Spin } from 'antd';

interface DataType {
  id: string;
  variants: string;
  results: any | null;
}

interface ResponseItem {
  id: string;
  variants: [string];
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
        const initialData: DataType[] = responseData.map((item: ResponseItem) => ({
          id: item.id,
          variants: item.variants,
          results: null,
        }));

        setData(initialData);
        setLoading(false);
        setStatsLoading(new Array(initialData.length).fill(true));

        initialData.forEach((item, index) => {
          fetchData(`http://localhost/api/app_evaluations/${item.id}/results`)
            .then(results => {
              setData(prevData => {
                const newData = [...prevData];
                newData[index].results = JSON.stringify(results.results);
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

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
    },
    {
      title: 'Variants',
      dataIndex: 'variants',
      key: 'variants',
    },
    {
      title: 'results',
      key: 'results',
      render: (text: string, record: DataType, index: number) => (
        statsLoading[index] ? <Spin /> : record.results
      ),
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
        />
      )}
    </div>
  );






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
};

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

export default Results;
