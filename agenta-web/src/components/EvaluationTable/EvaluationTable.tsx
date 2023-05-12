
import { useState, useEffect } from 'react';
import type { ColumnType } from 'antd/es/table';
import { LikeOutlined, DislikeOutlined, DownOutlined } from '@ant-design/icons';
import { Button, Dropdown, Input, Menu, Space, Table, TableColumnsType } from 'antd';
import { EditableCell, EditableRow } from './EditableTableComponents';
import { AppVersion } from '@/models/AppVersion';

interface EvaluationTableProps {
  columnsCount: number;
  appVersions: AppVersion[]
  onReady: (values: Object) => void;
}

interface TableDataType {
  key: string;
  [key: string]: any;
}

const EvaluationTable: React.FC<EvaluationTableProps> = ({ columnsCount, appVersions, onReady}) => {
  const initialData = Array.from({ length: 1 }, (_, i) => ({
    key: i.toString(),
    ...Array.from({ length: columnsCount }, (_, j) => ({ [`column${j}`]: `Data ${j}` })),
  }));

  const [dataSource, setDataSource] = useState<TableDataType[]>(initialData);
  const [selectedItems, setSelectedItems] = useState<string[]>(Array(columnsCount).fill('Select a version'));
  const [isSelected, setIsSelected] = useState<boolean[]>(Array(columnsCount).fill(false));
  const [valuationsData, setValuationsData] = useState<Object>({});

  const handleAddRow = () => {
    setDataSource(prevState => [
      ...prevState,
      { key: (prevState.length + 1).toString(), ...Array.from({ length: columnsCount }, (_, i) => ({ [`column${i}`]: `Data ${i}` })) },
    ]);
  };

  const handleMenuClick = (columnIndex: number) => ({ key }: { key: string }) => {
    console.log(columnIndex);
    
    setSelectedItems(prevState => {
      const newState = [...prevState];
      newState[columnIndex] = key;
      return newState;
    });

    setIsSelected(prevState => {
      const newState = [...prevState];
      newState[columnIndex] = true;
      return newState;
    });
    console.log(selectedItems);
    const a = {modelOne: selectedItems[0], modelTwo: selectedItems[1] }
    setValuationsData(a);
  };

  useEffect(() => {
    onReady(valuationsData);
  }, [valuationsData, onReady]);

  const components = {
    body: {
      row: EditableRow,
      cell: EditableCell,
    },
  };

  const dynamicColumns: ColumnType<TableDataType>[] = Array.from({ length: columnsCount }, (_, i) => {

    const columnKey = `column${i}`;
    const menu = (
      <Menu onClick={handleMenuClick(i)}>
        {appVersions.map((appVersion, index) =>
          <Menu.Item key={appVersion.name}>
            {appVersion.name}
          </Menu.Item>
        )}
      </Menu>
    );

    return ({
      title: (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          App Version:
          <Dropdown overlay={menu} placement="bottomRight" className={!isSelected[i] && appVersions.length > 0 ? 'button-animation' : ''}>
            <Button size="small">
              {selectedItems[i]} <DownOutlined />
            </Button>
          </Dropdown>
        </div>
      ),
      dataIndex: columnKey,
      key: columnKey,
      width: '20%'
    });
  });

  const columns = [
    {
      key: '1',
      title: 'Question',
      dataIndex: 'questionContent',
      render: () => (
        <Input></Input>)
    },
    ...dynamicColumns,
    {
      title: 'Evaluate',
      dataIndex: 'evaluate',
      key: 'evaluate',
      width: 200,
      // fixed: 'right',
      render: () => (
        <Space>
          <Button type="primary" ghost icon={<LikeOutlined />}>Good</Button>
          <Button icon={<DislikeOutlined />}>Bad</Button>
          <Button danger>Flag</Button>
        </Space>)
    }
  ];

  return (
    <div>
      <Table dataSource={dataSource} columns={columns} components={components} rowClassName={() => 'editable-row'} />
      <Button onClick={handleAddRow} type="primary" style={{ marginBottom: 16 }}>
        Add a row
      </Button>
    </div>
  )
}

export default EvaluationTable;


