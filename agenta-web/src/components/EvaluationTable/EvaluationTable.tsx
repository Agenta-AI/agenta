
import { useState, useEffect, useContext } from 'react';
import type { ColumnType } from 'antd/es/table';
import { DownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Button, Dropdown, Input, Menu, Row, Space, Spin, Table } from 'antd';
import { AppVariant } from '@/models/AppVariant';
import { runVariant, fetchVariantParameters } from '@/services/api';
import AppContext from '@/contexts/appContext';

interface EvaluationTableProps {
  columnsCount: number;
  appVariants: AppVariant[];
  dataset?: any;
  comparisonTableId?: string;
}

interface EvaluationTableRow {
  id?: number;
  inputFields: {
    input_name: string;
    input_value: string;
  }[];
  columnData0: string;
  columnData1: string;
  vote: string;
}
/**
 *
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @param appVariants - List of all app variants available for comparison
 * @param dataset -  The dataset selected for comparison
 * @param comparisonTableId - The id of the comparison table, used to save in the eval
 * @returns
 */
const EvaluationTable: React.FC<EvaluationTableProps> = ({ columnsCount, appVariants, dataset, comparisonTableId }) => {
  const { app } = useContext(AppContext);
  const [variantInputs, setVariantInputs] = useState<string[]>([]);
  const [selectedAppVariants, setSelectedAppVariants] = useState<string[]>(Array(columnsCount).fill('Select a variant'));
  //First let's get the variants parameters
  useEffect(() => {
    const fetchAndSetSchema = async () => {
      try {
        const variantParams = await fetchVariantParameters(app, appVariants[0].name);
        const variantInputs = variantParams.filter(obj => obj.input).map(param => param.name);
        setVariantInputs(variantInputs);
      } catch (e) {
        //pass

      } finally {
        //pass
      }
    };
    fetchAndSetSchema();
  }, [appVariants]);

  const [rows, setRows] = useState<EvaluationTableRow[]>(
    [{
      inputFields: [{ input_name: '', input_value: '' }],
      columnData0: '',
      columnData1: '',
      vote: ''

    }]);

  useEffect(() => {
    setRows([{
      inputFields: variantInputs.map((variantInput: string) => ({ input_name: variantInput, input_value: '' })),
      columnData0: '',
      columnData1: '',
      vote: ''
    }])
  }, [variantInputs]);

  useEffect(() => {
    const initialRows = dataset && dataset.length > 0 ? dataset.map((item: any) => {
      return {
        inputFields: variantInputs.map((input: string) => ({ input_name: input, input_value: item[input] })),
        columnData0: '',
        columnData1: '',
        vote: ''
      }
    }) : [];
    setRows([...initialRows, ...rows]);
  }, [dataset]);

  const handleAppVariantsMenuClick = (columnIndex: number) => ({ key }: { key: string }) => {
    const updateData = async (url = '', data = {}) => {
      const response = await fetch(url, {
        method: 'PUT',
        cache: 'no-cache',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify(data)
      });

      return response.json();
    };

    const data = {
      variants: [selectedAppVariants[0], selectedAppVariants[1]]
    };

    data.variants[columnIndex] = key;

    updateData(`http://localhost/api/app_evaluations/${comparisonTableId}`, data)
      .then(data => {
        setSelectedAppVariants(prevState => {
          const newState = [...prevState];
          newState[columnIndex] = key;
          return newState;
        });
      }).catch(err => {
        console.error(err);
      });
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    rowIndex: number,
    inputFieldKey: number
  ) => {
    const newRows = [...rows];
    newRows[rowIndex].inputFields[inputFieldKey].input_value = e.target.value;
    setRows(newRows);
  };

  const handleVoteClick = (rowIndex: number, vote: string) => {
    const evaluation_row_id = rows[rowIndex].id;

    if (evaluation_row_id) {
      setRowValue(rowIndex, 'vote', 'loading');
      const data = { vote: vote };
      const updateData = async (url = '', data = {}) => {
        const response = await fetch(url, {
          method: 'PUT',
          cache: 'no-cache',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          },
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
          body: JSON.stringify(data)
        });

        return response.json();
      };

      updateData(`http://localhost/api/app_evaluations/${comparisonTableId}/evaluation_row/${evaluation_row_id}`, data)
        .then(data => {
          setRowValue(rowIndex, 'vote', vote);
        }).catch(err => {
          console.error(err);
        });
    } else {
      const appVariantX = selectedAppVariants[0];
      const appVariantY = selectedAppVariants[1];
      const outputVariantX = rows[rowIndex].columnData0;
      const outputVariantY = rows[rowIndex].columnData1;
      const data = {
        "comparison_table_id": comparisonTableId,
        "inputs": rows[rowIndex].inputFields,
        "outputs": [
          { "variant_name": appVariantX, "variant_output": outputVariantX },
          { "variant_name": appVariantY, "variant_output": outputVariantY }
        ],
        "vote": vote
      };

      setRowValue(rowIndex, 'vote', 'loading');

      const postData = async (url = '', data = {}) => {
        const response = await fetch(url, {
          method: 'POST',
          cache: 'no-cache',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json'
          },
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
          body: JSON.stringify(data)
        });

        return response.json();
      };

      postData(`http://localhost/api/app_evaluations/${comparisonTableId}/evaluation_row`, data)
        .then(data => {
          setRowValue(rowIndex, 'vote', data.vote);
          setRowValue(rowIndex, 'id', data.id);
        }).catch(err => {
          console.error(err);
        });
    }
  }

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
    const appVariantX = selectedAppVariants[0];
    const appVariantY = selectedAppVariants[1];
    // const hasEmptyFields = Object.values(inputFields).some(value => !value);
    // if (hasEmptyFields) {
    //   console.log(`Skipping evaluation for row ${rowIndex} due to empty input fields.`);
    //   return;
    // }
    const queryString = rows[rowIndex].inputFields.map((item) => `${item.input_name}=${item.input_value}`).join('&');

    setRowValue(rowIndex, 'columnData0', 'loading...');
    setRowValue(rowIndex, 'columnData1', 'loading...');
    const requestX = fetch(`http://localhost/${app}/${appVariantX}/generate?${queryString}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }).then(res => res.json())
      .then(data => setRowValue(rowIndex, 'columnData0', data))
      .catch(e => console.log(e));

    const requestY = fetch(`http://localhost/${app}/${appVariantY}/generate?${queryString}`, {
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
    newRows[rowIndex][columnKey] = value as never;
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
          {variantInputs.length == record.inputFields.length && // initial value of inputFields is array with 1 element and variantInputs could contain more than 1 element
            variantInputs.map((variantInputName: string, index: number) =>
              <div style={{ marginBottom: 10 }}>
                <Input
                  key={index}
                  placeholder={record.inputFields[index].input_name}
                  value={record.inputFields[index].input_value}
                  onChange={(e) => handleInputChange(e, rowIndex, index)}
                />
              </div>
            )
          }

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
      render: (text: any, record: any, rowIndex: number) => (
        <Spin spinning={rows[rowIndex].vote === 'loading' ? true : false}>
          <Space>
            <Button
              type={rows[rowIndex].vote === selectedAppVariants[0] ? "primary" : "default"}
              onClick={() => handleVoteClick(rowIndex, selectedAppVariants[0])}
            >
              {`Variant: ${selectedAppVariants[0]}`}
            </Button>
            <Button
              type={rows[rowIndex].vote === selectedAppVariants[1] ? "primary" : "default"}
              onClick={() => handleVoteClick(rowIndex, selectedAppVariants[1])}
            >
              {`Variant: ${selectedAppVariants[1]}`}
            </Button>
            <Button
              type={rows[rowIndex].vote === '0' ? "primary" : "default"}
              danger
              onClick={() => handleVoteClick(rowIndex, '0')}
            >
              Both are bad
            </Button>
          </Space>
        </Spin>
      )
    }
  ];

  const addRow = () => {
    let inputFields: any = variantInputs.reduce((obj: any, value: string) => { obj[`${value}`] = ""; return obj; }, {});
    setRows([
      ...rows,
      {
        inputFields: variantInputs.map((variantInput: string) => ({ input_name: variantInput, input_value: '' })),
        columnData0: '',
        columnData1: '',
        vote: ''
      }
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
