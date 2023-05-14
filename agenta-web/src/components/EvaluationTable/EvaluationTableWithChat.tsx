import { useState, useEffect, useRef } from 'react';
import { Button, Dropdown, Input, Menu, Space, Table } from 'antd';
import { AppVersion } from '@/models/AppVersion';
import type { ColumnType } from 'antd/es/table';
import { DislikeOutlined, DownOutlined, LikeOutlined } from '@ant-design/icons';

interface EvaluationTableWithChatProps {
  columnsCount: number;
  appVersions: AppVersion[]
  onReady: (values: Object) => void;
}

interface TableDataType {
  key: React.Key;
  [key: string]: any;
}

const EvaluationTableWithChat: React.FC<EvaluationTableWithChatProps> = ({ columnsCount, appVersions, onReady }) => {
  const [dataSource, setDataSource] = useState<TableDataType[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>(Array(columnsCount).fill('Select a version'));
  const [isSelected, setIsSelected] = useState<boolean[]>(Array(columnsCount).fill(false));
  const [inputData, setInputData] = useState("");
  const inputRef = useRef<any>(null);

  const handleMenuClick = (columnIndex: number) => ({ key }: { key: string }) => {
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
    const a = { modelOne: selectedItems[0], modelTwo: selectedItems[1] }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputData) {
      setDataSource([...dataSource, { key: `${dataSource.length}`, ...dynamicColumns.reduce((acc, column) => ({ ...acc, [column.key as string]: inputData }), {}) }]);

      setInputData('');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputData(e.target.value);
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
      width: '50%'
    });
  });

  const columns = [
    ...dynamicColumns,
  ];

  return (
    <div>
      <Table
        dataSource={dataSource}
        columns={columns}
        footer={() => (
          <div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 15 }}>
              <Space>
                <Button type="primary" ghost icon={<LikeOutlined />}>Good</Button>
                <Button icon={<DislikeOutlined />}>Bad</Button>
                <Button danger>Flag</Button>
              </Space>
            </div>
            <div>
              <Input
                value={inputData}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="Enter text and press Enter to add row"
              />
            </div>
          </div>

        )}
        rowClassName={() => 'editable-row'}
      />
    </div>
  )
};

export default EvaluationTableWithChat;