
import { Spin, Table } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { useState, useEffect } from 'react';

interface DataType {
  id: string;
  name: string;
  created_date?: string;
}

const fetchData = async (url: string): Promise<any> => {
  const response = await fetch(url);
  return response.json();
}

const DatasetsTable: React.FC = () => {
  const [data, setData] = useState<DataType[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchData('http://localhost/api/datasets')
      .then(data => {
        setData(data);
        setLoading(false);
      });
  }, []);

  const columns: ColumnsType<DataType> = [
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
          dataSource={data}
          loading={loading}
        />
      )}
    </div>
  );
};

export default DatasetsTable;