
import { useState, useEffect, useContext } from 'react';
import type { ColumnType } from 'antd/es/table';
import { DownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Button, Dropdown, Input, Menu, Row, Space, Spin, Table, message } from 'antd';
import { Variant, Parameter } from '@/lib/Types';
import { updateAppEvaluations, updateEvaluationRow, postEvaluationRow, getVariantParameters } from '@/lib/services/api';
import AppContext from '@/contexts/appContext';
import { set } from 'cypress/types/lodash';

interface EvaluationTableProps {
    columnsCount: number;
    variants: Variant[];
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
 * @param dataset -        The dataset selected for comparison
 * @param comparisonTableId - The id of the comparison table, used to save in the eval
 * @returns
 */
const EvaluationTable: React.FC<EvaluationTableProps> = ({ columnsCount, variants, dataset, comparisonTableId }) => {
    const { app } = useContext(AppContext);
    const [variantInputs, setVariantInputs] = useState<string[]>([]);
    const [isError, setIsError] = useState(false);
    // const [selectedAppVariants, setSelectedVariants] = useState<string[]>(Array(columnsCount).fill('Select a variant'));
    const [selectedVariants, setSelectedVariants] = useState<Variant[]>(new Array(columnsCount).fill({ variantName: 'Select a variant' }));    //First let's get the variants parameters
    useEffect(() => {
        const fetchAndSetSchema = async () => {
            try {
                if (variants.length > 0) {
                    const { inputParams } = await getVariantParameters(app, variants[0]);
                    setVariantInputs(inputParams.map((inputParam: Parameter) => inputParam.name));
                } else {
                    setVariantInputs([]);
                }
            } catch (e) {
                setIsError(true);
            }
        };
        fetchAndSetSchema();
    }, [variants]);

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
    }, [dataset, variantInputs]);

    const handleAppVariantsMenuClick = (columnIndex: number) => ({ key }: { key: string }) => {

        const data = {
            variants: [selectedVariants[0].variantName, selectedVariants[1].variantName]
        };

        data.variants[columnIndex] = key;
        const selectedVariant = variants.find(variant => variant.variantName === key);

        if (!selectedVariant) {
            console.log('Error: No variant found');
        }
        console.log('comparisonTableId', comparisonTableId);
        updateAppEvaluations(comparisonTableId, data)
            .then(data => {
                setSelectedVariants(prevState => {
                    const newState = [...prevState];
                    newState[columnIndex] = selectedVariant;
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

            updateEvaluationRow(comparisonTableId, evaluation_row_id, data)
                .then(data => {
                    setRowValue(rowIndex, 'vote', vote);
                }).catch(err => {
                    console.error(err);
                });
        } else {
            const appVariantNameX = selectedVariants[0].variantName;
            const appVariantNameY = selectedVariants[1].variantName;
            const outputVariantX = rows[rowIndex].columnData0;
            const outputVariantY = rows[rowIndex].columnData1;
            const data = {
                "comparison_table_id": comparisonTableId,
                "inputs": rows[rowIndex].inputFields,
                "outputs": [
                    { "variant_name": appVariantNameX, "variant_output": outputVariantX },
                    { "variant_name": appVariantNameY, "variant_output": outputVariantY }
                ],
                "vote": vote
            };

            setRowValue(rowIndex, 'vote', 'loading');


            postEvaluationRow(comparisonTableId, data)
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
        const appVariantX = selectedVariants[0];
        const appVariantY = selectedVariants[1];
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
                {variants.map((variant, index) =>
                    <Menu.Item key={variant.variantName}>
                        {variant.variantName}
                    </Menu.Item>
                )}
            </Menu>
        );

        return ({
            title: (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    App Variant:
                    <Dropdown overlay={menu} placement="bottomRight" className={selectedVariants[i].variantName == 'Select a variant' ? 'button-animation' : ''}>
                        <Button size="small">
                            {selectedVariants[i].variantName} <DownOutlined />
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
                            type={rows[rowIndex].vote === selectedVariants[0].variantName ? "primary" : "default"}
                            onClick={() => handleVoteClick(rowIndex, selectedVariants[0].variantName)}
                        >
                            {`Variant: ${selectedVariants[0].variantName}`}
                        </Button>
                        <Button
                            type={rows[rowIndex].vote === selectedVariants[1].variantName ? "primary" : "default"}
                            onClick={() => handleVoteClick(rowIndex, selectedVariants[1].variantName)}
                        >
                            {`Variant: ${selectedVariants[1].variantName}`}
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
