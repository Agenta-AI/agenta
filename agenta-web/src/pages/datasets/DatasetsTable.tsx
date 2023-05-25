
import { Dataset } from '@/lib/Types';
import { Spin, Table } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { useState, useEffect } from 'react';

type Props = {
  dataset: Dataset;
};

const fetchData = async (url: string): Promise<any> => {
  const response = await fetch(url);
  return response.json();
}

const DatasetsTable: React.FC<Props>= ({ dataset }) => {
  const [fetchedDatasets, setFetchedDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchData('http://localhost/api/datasets')
      .then(data => {
        setFetchedDatasets(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const newDatasets = [dataset, ...fetchedDatasets];
    setFetchedDatasets(newDatasets);
  }, [dataset]);

  const columns: ColumnsType<Dataset> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: 'Creation date',
      dataIndex: 'created_date',
      key: 'created_date',
    },
  ];

  return (
    <div>
      {loading ? (
        <Spin />
      ) : (
        <Table
          columns={columns}
          dataSource={fetchedDatasets}
          loading={loading}
        />
      )}
    </div>
  );
};

export default DatasetsTable;