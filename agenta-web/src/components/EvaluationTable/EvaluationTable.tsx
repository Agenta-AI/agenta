
import { useState, useEffect } from 'react';
import type { ColumnType } from 'antd/es/table';
import { LikeOutlined, DislikeOutlined, DownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Button, Dropdown, Input, Menu, Row, Space, Table } from 'antd';
import { AppVariant } from '@/models/AppVariant';

interface EvaluationTableProps {
  columnsCount: number;
  appVariants: AppVariant[];
  dataset?: any;
}

interface EvaluationTableRow {
  inputFields: {
    field1: string;
    field2: string;
  };
  columnData0: string;
  columnData1: string;
}

const EvaluationTable: React.FC<EvaluationTableProps> = ({ columnsCount, appVariants, dataset }) => {
  const [selectedAppVariants, setSelectedAppVariants] = useState<string[]>(Array(columnsCount).fill('Select a variant'));
  const [rows, setRows] = useState<EvaluationTableRow[]>(
    [{
      inputFields: { field1: '', field2: '' },
      columnData0: '',
      columnData1: ''
    }
    ]);

  useEffect(() => {
    const initialRows = dataset && dataset.length > 0 ? dataset.map((item: any) => ({
      inputFields: { field1: item.startup_name, field2: item.startup_idea },
      columnData0: '',
      columnData1: ''
    })) : [];
    setRows([...initialRows, ...rows]);
  }, [dataset]);

  const handleAppVariantsMenuClick = (columnIndex: number) => ({ key }: { key: string }) => {
    setSelectedAppVariants(prevState => {
      const newState = [...prevState];
      newState[columnIndex] = key;
      return newState;
    });
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    rowIndex: number,
    inputFieldKey: "field1" | "field2"
  ) => {
    const newRows = [...rows];
    newRows[rowIndex].inputFields[inputFieldKey] = e.target.value;
    setRows(newRows);
  };

  const runAllEvaluations = async () => {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < rows.length; i++) {
      promises.push(runEvaluation(i));
    }

    Promise.all(promises)
      .then(() => console.log('All functions finished.'))
      .catch(err => console.error('An error occurred:', err));
  };

  const runEvaluation = async (rowIndex: number) => {
    const startupName = rows[rowIndex].inputFields.field1;
    const startupIdea = rows[rowIndex].inputFields.field2;
    const appVariantX = selectedAppVariants[0];
    const appVariantY = selectedAppVariants[1];

    if (!startupName || !startupIdea) {
      console.log(`Skipping evaluation for row ${rowIndex} due to empty startupName or startupIdea.`);
      return;
    }

    setRowValue(rowIndex, 'columnData0', 'loading...');
    setRowValue(rowIndex, 'columnData1', 'loading...');

    const requestX = fetch(`http://localhost/pitch_genius/${appVariantX}/generate?startup_name=${startupName}&startup_idea=${startupIdea}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }).then(res => res.json())
      .then(data => setRowValue(rowIndex, 'columnData0', data))
      .catch(e => console.log(e));

    const requestY = fetch(`http://localhost/pitch_genius/${appVariantY}/generate?startup_name=${startupName}&startup_idea=${startupIdea}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }).then(res => res.json())
      .then(data => setRowValue(rowIndex, 'columnData1', data))
      .catch(e => console.log(e));

    await Promise.all([requestX, requestY]);
  }

  const setRowValue = (rowIndex: number, columnKey: keyof EvaluationTableRow, value: any) => {
    const newRows = [...rows];
    newRows[rowIndex][columnKey] = value;
    setRows(newRows);
  };

  const dynamicColumns: ColumnType<EvaluationTableRow>[] = Array.from({ length: columnsCount }, (_, i) => {
    const columnKey = `columnData${i}`;

    const menu = (
      <Menu onClick={handleAppVariantsMenuClick(i)}>
        {appVariants.map((appVariant, index) =>
          <Menu.Item key={appVariant.name}>
            {appVariant.name}
          </Menu.Item>
        )}
      </Menu>
    );

    return ({
      title: (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          App Variant:
          <Dropdown overlay={menu} placement="bottomRight" className={selectedAppVariants[i] == 'Select a variant' ? 'button-animation' : ''}>
            <Button size="small">
              {selectedAppVariants[i]} <DownOutlined />
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
      title: (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          Question
          <Button size="small" onClick={runAllEvaluations} icon={<CaretRightOutlined />}>Run All</Button>
        </div>
      ),
      dataIndex: 'inputFields',
      render: (text: any, record: EvaluationTableRow, rowIndex: number) => (
        <div>
          <div style={{ marginBottom: 10 }}>
            <Input
              placeholder="Startup name"
              value={record.inputFields.field1}
              onChange={(e) => handleInputChange(e, rowIndex, "field1")}
            />

          </div>
          <div style={{ marginBottom: 10 }}>
            <Input
              placeholder="Startup idea"
              value={record.inputFields.field2}
              onChange={(e) => handleInputChange(e, rowIndex, "field2")}
            />
          </div>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => (runEvaluation(rowIndex))} icon={<CaretRightOutlined />} style={{ marginLeft: 10 }}>Run</Button>
          </div>
        </div>
      )
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

  const addRow = () => {
    setRows([
      ...rows,
      { inputFields: { field1: "", field2: "" }, columnData0: "", columnData1: "" },
    ]);
  };

  return (
    <div>
      <Table
        dataSource={rows}
        columns={columns}
        pagination={false}
        rowClassName={() => 'editable-row'}
      />
      <Button onClick={addRow} style={{ marginTop: 16 }}>
        Add a row
      </Button>
    </div>
  )
}

export default EvaluationTable;
