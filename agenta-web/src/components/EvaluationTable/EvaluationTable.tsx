
import { useState, useEffect, useContext } from 'react';
import type { ColumnType } from 'antd/es/table';
import { DownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Button, Dropdown, Input, Menu, Row, Space, Spin, Table, message } from 'antd';
import { Variant, Parameter } from '@/lib/Types';
import { updateEvaluationRow, postEvaluationRow, getVariantParameters, callVariant } from '@/lib/services/api';
import { useVariant } from '@/lib/hooks/useVariant';
import { useRouter } from 'next/router';

interface EvaluationTableProps {
    columnsCount: number;
    variants: Variant[];
    dataset: any;
    comparisonTableId: string;
}

interface EvaluationTableRow {
    id?: string;
    inputFields: {
        input_name: string;
        input_value: string;
    }[];
    columnData0: string;
    columnData1: string;
    vote: string;
    evaluationFlow: EvaluationFlow;
}
/**
 *
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @param appVariants - List of all app variants available for comparison
 * @param dataset -        The dataset selected for comparison
 * @param comparisonTableId - The id of the comparison table, used to save in the eval
 * @returns
 */

enum EvaluationFlow {
    EVALUATION_STARTED,
    VOTE_STARTED,
    COMPARISON_RUN_STARTED
}

const EvaluationTable: React.FC<EvaluationTableProps> = ({ columnsCount, variants, dataset, comparisonTableId }) => {
    const router = useRouter();
    const { app_name } = router.query;
    const [variantInputs, setVariantInputs] = useState<string[]>([]);
    const [isError, setIsError] = useState(false);

    const variantData = variants.map((variant, index) => {
        const { optParams, URIPath, isLoading, isError, error } = useVariant(app_name, variant);

        return {
            optParams,
            URIPath,
            isLoading,
            isError,
            error
        };
    });
    useEffect(() => {
        // TODO: move this to the evaluation component. so that we fetch evertything for this component
        const fetchAndSetSchema = async () => {
            try {
                if (variants.length > 0) {
                    const { inputParams } = await getVariantParameters(app_name, variants[0]);
                    setVariantInputs(inputParams.map((inputParam: Parameter) => inputParam.name));
                }
            } catch (e) {
                setIsError(true);
            }
        };
        fetchAndSetSchema();
    }, [app_name, variants]);

    const [rows, setRows] = useState<EvaluationTableRow[]>([]);

    useEffect(() => {
        if (variantInputs.length > 0) {
            const initialRows = dataset && dataset.length > 0 ? dataset.map((item: any) => {
                return {
                    inputFields: variantInputs.map((input: string) => ({ input_name: input, input_value: item[input] })),
                    columnData0: '',
                    columnData1: '',
                    vote: '',
                    evaluationFlow: EvaluationFlow.EVALUATION_STARTED
                }
            }) : [];
            setRows([...initialRows, ...rows]);
        }

    }, [variantInputs, dataset]);

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
            const appVariantNameX = variants[0].variantName;
            const appVariantNameY = variants[1].variantName;
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
        const inputParamsDict = rows[rowIndex].inputFields.reduce((acc, item) => { acc[item.input_name] = item.input_value; return acc; }, {});

        const columnsDataNames = ['columnData0', 'columnData1']
        columnsDataNames.forEach(async (columnName: any, idx: number) => {

            setRowValue(rowIndex, columnName, 'loading...');
            try {
                let result = await callVariant(inputParamsDict, variantData[idx].optParams, variantData[idx].URIPath);
                setRowValue(rowIndex, columnName, result);
                setRowValue(rowIndex, 'evaluationFlow', EvaluationFlow.COMPARISON_RUN_STARTED);
            }

            catch (e) {
                console.error('Error:', e)
            }
        });
    }

    const setRowValue = (rowIndex: number, columnKey: keyof EvaluationTableRow, value: any) => {
        const newRows = [...rows];
        newRows[rowIndex][columnKey] = value as never;
        setRows(newRows);
    };

    const dynamicColumns: ColumnType<EvaluationTableRow>[] = Array.from({ length: columnsCount }, (_, i) => {
        const columnKey = `columnData${i}`;

        return ({
            title: (
                <div>
                    App Variant: {variants[i].variantName}
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
                    Inputs
                    <Button size="small" onClick={runAllEvaluations} icon={<CaretRightOutlined />}>Run All</Button>
                </div>
            ),
            dataIndex: 'inputFields',
            render: (text: any, record: EvaluationTableRow, rowIndex: number) => (
                <div>
                    {variantInputs.length == record.inputFields.length && // initial value of inputFields is array with 1 element and variantInputs could contain more than 1 element
                        variantInputs.map((variantInputName: string, index: number) =>
                            <div style={{ marginBottom: 10 }} key={index}>
                                <Input
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
                            type={rows[rowIndex].vote === variants[0].variantName ? "primary" : "default"}
                            disabled={rows[rowIndex].evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED ? false : true}
                            onClick={() => handleVoteClick(rowIndex, variants[0].variantName)}
                        >
                            {`Variant: ${variants[0].variantName}`}
                        </Button>
                        <Button
                            type={rows[rowIndex].vote === variants[1].variantName ? "primary" : "default"}
                            disabled={rows[rowIndex].evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED ? false : true}
                            onClick={() => handleVoteClick(rowIndex, variants[1].variantName)}
                        >
                            {`Variant: ${variants[1].variantName}`}
                        </Button>
                        <Button
                            type={rows[rowIndex].vote === '0' ? "primary" : "default"}
                            disabled={rows[rowIndex].evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED ? false : true}
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
        setRows([
            ...rows,
            {
                inputFields: variantInputs.map((variantInput: string) => ({ input_name: variantInput, input_value: '' })),
                columnData0: '',
                columnData1: '',
                vote: '',
                evaluationFlow: EvaluationFlow.EVALUATION_STARTED
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