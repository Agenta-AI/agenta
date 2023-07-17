
import { useState, useEffect } from 'react';
import type { ColumnType } from 'antd/es/table';
import { CaretRightOutlined } from '@ant-design/icons';
import { Button, Input, Space, Spin, Table } from 'antd';
import { Variant, Parameter } from '@/lib/Types';
import { updateEvaluationRow, callVariant } from '@/lib/services/api';
import { useVariant } from '@/lib/hooks/useVariant';
import { useRouter } from 'next/router';
import { EvaluationFlow } from '@/lib/enums';
import { fetchVariants } from '@/lib/services/api';

interface EvaluationTableProps {
    appEvaluation: any;
    columnsCount: number;
    evaluationRows: EvaluationTableRow[];
}

interface EvaluationTableRow {
    id?: string;
    inputs: {
        input_name: string;
        input_value: string;
    }[];
    outputs: {
        variant_name: string;
        variant_output: string;
    }[];
    columnData0: string;
    columnData1: string;
    vote: string;
    evaluationFlow: EvaluationFlow;
}
/**
 *
 * @param appEvaluation - Evaluation object
 * @param evaluationRows - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */

const EvaluationTable: React.FC<EvaluationTableProps> = ({ appEvaluation, evaluationRows, columnsCount }) => {
    const router = useRouter();
    let app_name = '';
    if (Array.isArray(router.query.app_name)) {
        app_name = router.query.app_name[0];
    } else if (typeof router.query.app_name === 'string') {
        app_name = router.query.app_name;
    }
    const variants = appEvaluation.variants;

    const variantData = variants.map((variant: Variant) => {
        const { optParams, URIPath, isLoading, isError, error } = useVariant(app_name, variant);

        return {
            optParams,
            URIPath,
            isLoading,
            isError,
            error
        };
    });

    const [rows, setRows] = useState<EvaluationTableRow[]>([]);

    useEffect(() => {
        if (evaluationRows) {
            setRows(evaluationRows);
        }
    }, [evaluationRows]);

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement>,
        rowIndex: number,
        inputFieldKey: number
    ) => {
        const newRows = [...rows];
        newRows[rowIndex].inputs[inputFieldKey].input_value = e.target.value;
        setRows(newRows);
    };

    const handleVoteClick = (rowIndex: number, vote: string) => {
        const evaluation_row_id = rows[rowIndex].id;

        if (evaluation_row_id) {
            setRowValue(rowIndex, 'vote', 'loading');
            // TODO: improve this to make it dynamic
            const appVariantNameX = variants[0].variantName;
            const appVariantNameY = variants[1].variantName;
            const outputVariantX = rows[rowIndex].columnData0;
            const outputVariantY = rows[rowIndex].columnData1;
            const data = {
                vote: vote,
                outputs: [
                    { "variant_name": appVariantNameX, "variant_output": outputVariantX },
                    { "variant_name": appVariantNameY, "variant_output": outputVariantY }
                ],
            };

            updateEvaluationRow(appEvaluation.id, evaluation_row_id, data, appEvaluation.evaluationType)
                .then(data => {
                    setRowValue(rowIndex, 'vote', vote);
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
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: { [key: string]: any }, item) => { acc[item.input_name] = item.input_value; return acc; }, {});

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
                    <span>App Variant: </span>
                    <span style={{ backgroundColor: 'rgb(201 255 216)', padding: 4, borderRadius: 5 }}>
                        {variants ? variants[i].variantName : ""}
                    </span>
                </div>
            ),
            dataIndex: columnKey,
            key: columnKey,
            width: '20%',
            render: (text: any, record: EvaluationTableRow, rowIndex: number) => {
                if (record.outputs && record.outputs.length > 0) {
                    const outputValue = record.outputs.find((output: any) => output.variant_name === variants[i].variantName)?.variant_output;
                    return (
                        <div>{outputValue}</div>
                    )
                }
                return text;
            }
        });
    });

    const columns = [
        {
            key: '1',
            title: (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div >
                        <span> Inputs (Test set: </span>
                        <span style={{ backgroundColor: 'rgb(201 255 216)', padding: 4, borderRadius: 5 }}>
                            {appEvaluation.dataset.name}
                        </span>
                        <span> )</span>
                    </div>
                    <Button size="small" onClick={runAllEvaluations} icon={<CaretRightOutlined />}>Run All</Button>
                </div>
            ),
            dataIndex: 'inputs',
            render: (text: any, record: EvaluationTableRow, rowIndex: number) => (
                <div>
                    {record && record.inputs && record.inputs.length && // initial value of inputs is array with 1 element and variantInputs could contain more than 1 element
                        record.inputs.map((input: any, index: number) =>
                            <div style={{ marginBottom: 10 }} key={index}>
                                <Input
                                    placeholder={input.input_name}
                                    value={input.input_value}
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
                            type={record.vote === variants[0].variantName ? "primary" : "default"}
                            disabled={record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED || record.vote !== "" ? false : true}
                            onClick={() => handleVoteClick(rowIndex, variants[0].variantName)}
                        >
                            {`Variant: ${variants[0].variantName}`}
                        </Button>
                        <Button
                            type={record.vote === variants[1].variantName ? "primary" : "default"}
                            disabled={record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED || record.vote !== "" ? false : true}
                            onClick={() => handleVoteClick(rowIndex, variants[1].variantName)}
                        >
                            {`Variant: ${variants[1].variantName}`}
                        </Button>
                        <Button
                            type={record.vote === '0' ? "primary" : "default"}
                            disabled={record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED || record.vote !== "" ? false : true}
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
                inputs: appEvaluation.inputs.map((variantInput: string) => ({ input_name: variantInput, input_value: '' })),
                outputs: [],
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