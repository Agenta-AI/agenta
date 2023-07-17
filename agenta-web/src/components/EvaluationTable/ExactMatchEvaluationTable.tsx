import { useState, useEffect } from 'react';
import type { ColumnType } from 'antd/es/table';
import { ArrowUpOutlined, CaretRightOutlined, LineChartOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Input, Row, Space, Spin, Statistic, Table, Tag } from 'antd';
import { Variant, Parameter } from '@/lib/Types';
import { updateEvaluationRow, callVariant } from '@/lib/services/api';
import { useVariant } from '@/lib/hooks/useVariant';
import { useRouter } from 'next/router';
import { EvaluationFlow } from '@/lib/enums';
import { fetchVariants } from '@/lib/services/api';

interface ExactMatchEvaluationTableProps {
    appEvaluation: any;
    columnsCount: number;
    evaluationRows: ExactMatchEvaluationTableRow[];
}

interface ExactMatchEvaluationTableRow {
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
    correctAnswer: string;
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

const ExactMatchEvaluationTable: React.FC<ExactMatchEvaluationTableProps> = ({ appEvaluation, evaluationRows, columnsCount }) => {
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

    const [rows, setRows] = useState<ExactMatchEvaluationTableRow[]>([]);
    const [wrongAnswers, setWrongAnswers] = useState<number>(0);
    const [correctAnswers, setCorrectAnswers] = useState<number>(0);
    const [accuracy, setAccuracy] = useState<number>(0);

    useEffect(() => {
        if (evaluationRows) {
            setRows(evaluationRows);
        }
    }, [evaluationRows]);

    useEffect(() => {
        if (correctAnswers + wrongAnswers > 0) {
            setAccuracy((correctAnswers / (correctAnswers + wrongAnswers)) * 100);
        }
        else {
            setAccuracy(0);
        }
    }, [correctAnswers, wrongAnswers]);

    useEffect(() => {
        const correct = rows.filter(row => row.vote === 'correct').length;
        const wrong = rows.filter(row => row.vote === 'wrong').length;
        const accuracy = correct + wrong > 0 ? (correct / (correct + wrong)) * 100 : 0;

        setCorrectAnswers(correct);
        setWrongAnswers(wrong);
        setAccuracy(accuracy);
    }, [rows]);

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement>,
        rowIndex: number,
        inputFieldKey: number
    ) => {
        const newRows = [...rows];
        newRows[rowIndex].inputs[inputFieldKey].input_value = e.target.value;
        setRows(newRows);
    };

    const runAllEvaluations = async () => {
        const promises: Promise<void>[] = [];

        for (let i = 0; i < rows.length; i++) {
            promises.push(runEvaluation(i));
        }

        Promise.all(promises)
            .then(() => {
                console.log('All functions finished.')
            })
            .catch(err => console.error('An error occurred:', err));
    };

    const runEvaluation = async (rowIndex: number) => {
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: { [key: string]: any }, item) => { acc[item.input_name] = item.input_value; return acc; }, {});

        const columnsDataNames = ['columnData0']
        columnsDataNames.forEach(async (columnName: any, idx: number) => {

            setRowValue(rowIndex, columnName, 'loading...');
            try {
                let result = await callVariant(inputParamsDict, variantData[idx].optParams, variantData[idx].URIPath);
                setRowValue(rowIndex, columnName, result);
                setRowValue(rowIndex, 'evaluationFlow', EvaluationFlow.COMPARISON_RUN_STARTED);
                evaluateWithExactMatch(rowIndex);
            }

            catch (e) {
                console.error('Error:', e)
            }
        });
    }

    /**
     *
     * @param rowNumber
     *
     * This method will:
     * 1. perform an exact match evaluation for the given row number
     * 2. update the evaluation row with the result
     * 3. update the vote column in the table
     */
    const evaluateWithExactMatch = (rowNumber: number) => {
        const isCorrect = rows[rowNumber].columnData0 === rows[rowNumber].correctAnswer;
        const evaluation_row_id = rows[rowNumber].id;
        // TODO: we need to improve this and make it dynamic
        const appVariantNameX = variants[0].variantName;
        const outputVariantX = rows[rowNumber].columnData0;

        if (evaluation_row_id) {
            const data = {
                vote: isCorrect ? 'correct' : 'wrong',
                outputs: [
                    { "variant_name": appVariantNameX, "variant_output": outputVariantX }
                ]
            };

            updateEvaluationRow(appEvaluation.id, evaluation_row_id, data)
                .then(data => {
                    setRowValue(rowNumber, 'vote', data.vote);
                    if (isCorrect) {
                        setCorrectAnswers(prevCorrect => prevCorrect + 1);
                    }
                    else {
                        setWrongAnswers(prevWrong => prevWrong + 1);
                    }
                }).catch(err => {
                    console.error(err);
                });
        }
    }

    const setRowValue = (rowIndex: number, columnKey: keyof ExactMatchEvaluationTableRow, value: any) => {
        const newRows = [...rows];
        newRows[rowIndex][columnKey] = value as never;
        setRows(newRows);
    };

    const dynamicColumns: ColumnType<ExactMatchEvaluationTableRow>[] = Array.from({ length: columnsCount }, (_, i) => {
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
            width: '25%',
            render: (text: any, record: ExactMatchEvaluationTableRow, rowIndex: number) => {
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
            width: '30%',
            title: (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div >
                        <span> Inputs (Test set: </span>
                        <span style={{ backgroundColor: 'rgb(201 255 216)', padding: 4, borderRadius: 5 }}>
                            {appEvaluation.dataset.name}
                        </span>
                        <span> )</span>
                    </div>
                </div>
            ),
            dataIndex: 'inputs',
            render: (text: any, record: ExactMatchEvaluationTableRow, rowIndex: number) => (
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
                </div>
            )
        },
        ...dynamicColumns,
        {
            title: 'Correct Answer',
            dataIndex: 'correctAnswer',
            key: 'correctAnswer',
            width: '25%',

            render: (text: any, record: any, rowIndex: number) => (
                <div>{record.correctAnswer}</div>
            )
        },
        {
            title: 'Evaluation',
            dataIndex: 'evaluation',
            key: 'evaluation',
            width: 200,
            align: 'center' as 'left' | 'right' | 'center',
            render: (text: any, record: any, rowIndex: number) => {
                let tagColor = ''
                if (record.vote === 'correct') {
                    tagColor = 'green'
                } else if (record.vote === 'wrong') {
                    tagColor = 'red'
                }
                return (
                    <Spin spinning={rows[rowIndex].vote === 'loading' ? true : false}>
                        <Space>
                            <div>
                                {rows[rowIndex].vote !== '' &&
                                    <Tag color={tagColor} style={{ fontSize: '14px' }}>
                                        {record.vote}
                                    </Tag>
                                }
                            </div>
                        </Space>
                    </Spin>
                )
            }
        }
    ];

    const addRow = () => {
        setRows([
            ...rows,
            {
                inputs: appEvaluation.inputs.map((variantInput: string) => ({ input_name: variantInput, input_value: '' })),
                outputs: [],
                columnData0: '',
                vote: '',
                correctAnswer: '',
                evaluationFlow: EvaluationFlow.EVALUATION_STARTED
            }
        ]);
    };

    return (
        <div>
            <h1>Exact match Evaluation</h1>
            <div >
                <Row align="middle">

                    <Col span={12}>
                        <Button type="primary" onClick={runAllEvaluations} icon={<LineChartOutlined />} size="large">
                            Run Evaluation
                        </Button>
                    </Col>

                    <Col span={12}>
                        <Card bordered={true} style={{ marginBottom: 20 }}>
                            <Row justify="end">
                                <Col span={10}>
                                    <Statistic
                                        title="Correct answers:"
                                        value={`${correctAnswers} out of ${rows.length}`}
                                        valueStyle={{ color: '#3f8600' }}
                                    />
                                </Col>
                                <Col span={10}>
                                    <Statistic
                                        title="Wrong answers:"
                                        value={`${wrongAnswers} out of ${rows.length}`}
                                        valueStyle={{ color: '#cf1322' }}
                                    />
                                </Col>
                                <Col span={4}>
                                    <Statistic
                                        title="Accuracy:"
                                        value={accuracy}
                                        precision={2}
                                        valueStyle={{ color: '' }}
                                        suffix="%"
                                    />
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                </Row>
            </div>
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
        </div>
    )
}

export default ExactMatchEvaluationTable;