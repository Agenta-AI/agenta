import DeleteEvaluationModal from "@/components/DeleteEvaluationModal/DeleteEvaluationModal"
import HumanEvaluationModal from "@/components/HumanEvaluationModal/HumanEvaluationModal"
import {getAppValues} from "@/contexts/app.context"
import {EvaluationType} from "@/lib/enums"
import {calculateAvgScore} from "@/lib/helpers/evaluate"
import {convertToCsv, downloadCsv} from "@/lib/helpers/fileManipulations"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {
    fromEvaluationResponseToEvaluation,
    singleModelTestEvaluationTransformer,
} from "@/lib/transformers"
import {Evaluation, JSSTheme, SingleModelEvaluationListTableDataType} from "@/lib/Types"
import {
    deleteEvaluations,
    fetchAllLoadEvaluations,
    fetchEvaluationResults,
} from "@/services/human-evaluations/api"
import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Database, Export, GearSix, Note, Plus, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, message, Space, Spin, Statistic, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {formatDate24} from "@/lib/helpers/dateTimeHelper"

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > div h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
    stat: {
        lineHeight: theme.lineHeight,
        "& .ant-statistic-content-value": {
            fontSize: theme.fontSize,
            color: theme.colorPrimary,
        },
        "& .ant-statistic-content-suffix": {
            fontSize: theme.fontSize,
            color: theme.colorPrimary,
        },
    },
    button: {
        display: "flex",
        alignItems: "center",
    },
}))

const SingleModelEvaluation = ({viewType}: {viewType: "evaluation" | "overview"}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const [evaluationsList, setEvaluationsList] = useState<
        SingleModelEvaluationListTableDataType[]
    >([])
    const [fetchingEvaluations, setFetchingEvaluations] = useState(false)
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false)
    const [selectedEvalRecord, setSelectedEvalRecord] =
        useState<SingleModelEvaluationListTableDataType>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeleteEvalMultipleModalOpen, setIsDeleteEvalMultipleModalOpen] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    useEffect(() => {
        if (!appId) return

        const fetchEvaluations = async () => {
            try {
                setFetchingEvaluations(true)
                const evals: Evaluation[] = (await fetchAllLoadEvaluations(appId)).map(
                    fromEvaluationResponseToEvaluation,
                )
                const results = await Promise.all(evals.map((e) => fetchEvaluationResults(e.id)))
                const newEvals = results.map((result, ix) => {
                    const item = evals[ix]
                    if ([EvaluationType.single_model_test].includes(item.evaluationType)) {
                        return singleModelTestEvaluationTransformer({item, result})
                    }
                })

                const newEvalResults = newEvals
                    .filter((evaluation) => evaluation !== undefined)
                    .filter(
                        (item: any) =>
                            item.resultsData !== undefined ||
                            !(Object.keys(item.scoresData || {}).length === 0) ||
                            item.avgScore !== undefined,
                    )
                    .sort(
                        (a, b) =>
                            new Date(b?.createdAt ?? 0).getTime() -
                            new Date(a?.createdAt ?? 0).getTime(),
                    )

                setEvaluationsList(
                    viewType === "overview" ? newEvalResults.slice(0, 5) : (newEvalResults as any),
                )
            } catch (error) {
                console.error(error)
            } finally {
                setFetchingEvaluations(false)
            }
        }

        fetchEvaluations()
    }, [appId])

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const handleDeleteMultipleEvaluations = async () => {
        const evaluationsIds = selectedRowKeys.map((key) => key.toString())
        try {
            setFetchingEvaluations(true)
            await deleteEvaluations(evaluationsIds)
            setEvaluationsList((prevEvaluationsList) =>
                prevEvaluationsList.filter(
                    (evaluation) => !evaluationsIds.includes(evaluation.key),
                ),
            )
            setSelectedRowKeys([])
            message.success("Evaluations Deleted")
        } catch (error) {
            console.error(error)
        } finally {
            setFetchingEvaluations(false)
        }
    }

    const handleNavigation = (variantName: string, revisionNum: string) => {
        router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const handleDeleteEvaluation = async (record: SingleModelEvaluationListTableDataType) => {
        try {
            setFetchingEvaluations(true)
            await deleteEvaluations([record.key])
            setEvaluationsList((prevEvaluationsList) =>
                prevEvaluationsList.filter((evaluation) => ![record.key].includes(evaluation.key)),
            )
            message.success("Evaluation Deleted")
        } catch (error) {
            console.error(error)
        } finally {
            setFetchingEvaluations(false)
        }
    }

    const columns: ColumnsType<SingleModelEvaluationListTableDataType> = [
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record: SingleModelEvaluationListTableDataType) => {
                return (
                    <span>
                        {variantNameWithRev({
                            variant_name: value[0].variantName,
                            revision: record.revisions[0],
                        })}
                    </span>
                )
            },
        },
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "Average score",
            dataIndex: "averageScore",
            key: "averageScore",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                const score = calculateAvgScore(record)
                return (
                    <span>
                        <Statistic
                            className={classes.stat}
                            value={score}
                            precision={score <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </span>
                )
            },
        },
        {
            title: "Created on",
            dataIndex: "createdAt",
            key: "createdAt",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
        },
        {
            title: <GearSix size={16} />,
            key: "key",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "details",
                                    label: "Open details",
                                    icon: <Note size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(
                                            `/apps/${appId}/evaluations/single_model_test/${record.key}`,
                                        )
                                    },
                                },
                                {
                                    key: "variant",
                                    label: "View variant",
                                    icon: <Rocket size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleNavigation(
                                            record.variants[0].variantName,
                                            record.revisions[0],
                                        )
                                    },
                                },
                                {
                                    key: "view_testset",
                                    label: "View test set",
                                    icon: <Database size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`/testsets/${record.testset._id}`)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "delete_eval",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedEvalRecord(record)
                                        setIsDeleteEvalModalOpen(true)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            onClick={(e) => e.stopPropagation()}
                            type="text"
                            icon={<MoreOutlined />}
                        />
                    </Dropdown>
                )
            },
        },
    ]

    const onExport = () => {
        const exportEvals = evaluationsList.filter((e) =>
            selectedRowKeys.some((selected) => selected === e.key),
        )

        try {
            if (!!exportEvals.length) {
                const {currentApp} = getAppValues()
                const filename = `${currentApp?.app_name}_human_annotation.csv`

                const csvData = convertToCsv(
                    exportEvals.map((item) => {
                        return {
                            Variant: variantNameWithRev({
                                variant_name: item.variants[0].variantName ?? "",
                                revision: item.revisions[0],
                            }),
                            "Test set": item.testset.name,
                            "Average score": `${calculateAvgScore(item) || 0}%`,
                            "Created on": formatDate24(item.createdAt),
                        }
                    }),
                    columns
                        .filter((col) => typeof col.title === "string")
                        .map((col) => col.title as string),
                )
                downloadCsv(csvData, filename)
                setSelectedRowKeys([])
            }
        } catch (error) {
            message.error("Failed to export results. Plese try again later")
        }
    }

    return (
        <div className={classes.container}>
            {viewType === "overview" ? (
                <div className="flex items-center justify-between">
                    <Space>
                        <Title>Human Annotation</Title>

                        <Button
                            href={`/apps/${appId}/evaluations?selectedEvaluation=single_model_evaluation`}
                        >
                            View all
                        </Button>
                    </Space>

                    <Button icon={<PlusOutlined />} onClick={() => setIsEvalModalOpen(true)}>
                        Create new
                    </Button>
                </div>
            ) : (
                <div className="flex items-center justify-between">
                    <Button
                        type="primary"
                        icon={<Plus size={14} />}
                        className={classes.button}
                        onClick={() => setIsEvalModalOpen(true)}
                        data-cy="new-human-eval-modal-button"
                    >
                        Start new evaluation
                    </Button>

                    <Space>
                        <Button
                            danger
                            type="text"
                            icon={<Trash size={14} />}
                            className={classes.button}
                            onClick={() => setIsDeleteEvalMultipleModalOpen(true)}
                            disabled={selectedRowKeys.length == 0}
                        >
                            Delete
                        </Button>
                        <Button
                            type="text"
                            onClick={onExport}
                            icon={<Export size={14} className="mt-0.5" />}
                            className={classes.button}
                            disabled={selectedRowKeys.length == 0}
                        >
                            Export as CSV
                        </Button>
                    </Space>
                </div>
            )}

            <Spin spinning={fetchingEvaluations}>
                <Table
                    rowSelection={
                        viewType === "evaluation"
                            ? {
                                  type: "checkbox",
                                  columnWidth: 48,
                                  selectedRowKeys,
                                  ...rowSelection,
                              }
                            : undefined
                    }
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={evaluationsList}
                    scroll={{x: true}}
                    bordered
                    pagination={false}
                    onRow={(record) => ({
                        style: {cursor: "pointer"},
                        onClick: () =>
                            router.push(
                                `/apps/${appId}/evaluations/single_model_test/${record.key}`,
                            ),
                    })}
                />
            </Spin>

            <HumanEvaluationModal
                evaluationType={"single_model_test"}
                isEvalModalOpen={isEvalModalOpen}
                setIsEvalModalOpen={setIsEvalModalOpen}
            />

            {selectedEvalRecord && (
                <DeleteEvaluationModal
                    open={isDeleteEvalModalOpen}
                    onCancel={() => setIsDeleteEvalModalOpen(false)}
                    onOk={async () => {
                        await handleDeleteEvaluation(selectedEvalRecord)
                        setIsDeleteEvalModalOpen(false)
                    }}
                    evaluationType={"single model evaluation"}
                />
            )}
            {isDeleteEvalMultipleModalOpen && (
                <DeleteEvaluationModal
                    open={isDeleteEvalMultipleModalOpen}
                    onCancel={() => setIsDeleteEvalMultipleModalOpen(false)}
                    onOk={async () => {
                        await handleDeleteMultipleEvaluations()
                        setIsDeleteEvalMultipleModalOpen(false)
                    }}
                    evaluationType={"single model evaluation"}
                />
            )}
        </div>
    )
}

export default SingleModelEvaluation
