import {deleteEvaluations, loadEvaluations} from "@/lib/services/api"
import {Button, Table} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {ColumnsType} from "antd/es/table"
import {Variant} from "@/lib/Types"
import {DeleteOutlined} from "@ant-design/icons"
import {EvaluationTypeLabels} from "@/lib/helpers/utils"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"

interface EvaluationListTableDataType {
    key: string
    variants: string[]
    testset: {
        _id: string
        name: string
    }
    evaluationType: string
    status: EvaluationFlow
    // votesData: {
    //     variants_votes_data: {
    //         number_of_votes: number,
    //         percentage: number
    //     },
    //     flag_votes: { number_of_votes: number, percentage: number },
    // }
    createdAt: string
}

export default function EvaluationsList() {
    const router = useRouter()
    const [evaluationsList, setEvaluationsList] = useState<EvaluationListTableDataType[]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectionType, setSelectionType] = useState<"checkbox" | "radio">("checkbox")
    const [deletingLoading, setDeletingLoading] = useState<boolean>(true)

    const app_name = router.query.app_name?.toString() || ""

    useEffect(() => {
        if (!app_name) {
            return
        }
        const fetchEvaluations = async () => {
            try {
                const result = await loadEvaluations(app_name)
                let newList = result.map((obj: any) => {
                    let newObj: EvaluationListTableDataType = {
                        key: obj.id,
                        testset: obj.testset,
                        variants: obj.variants,
                        evaluationType: obj.evaluationType,
                        status: obj.status,
                        createdAt: obj.createdAt,
                    }
                    return newObj
                })
                setEvaluationsList(newList)
                setDeletingLoading(false)
            } catch (error) {
                console.log(error)
                // setError(error);
            }
        }

        fetchEvaluations()
    }, [app_name])

    const onCompleteEvaluation = (evaluation: any) => {
        // TODO: improve type
        const evaluationType =
            EvaluationType[evaluation.evaluationType as keyof typeof EvaluationType]

        if (evaluationType === EvaluationType.auto_exact_match) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/auto_exact_match`)
        } else if (evaluationType === EvaluationType.human_a_b_testing) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/human_a_b_testing`)
        } else if (evaluationType === EvaluationType.auto_similarity_match) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/auto_similarity_match`)
        } else if (evaluationType === EvaluationType.auto_ai_critique) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/auto_ai_critique`)
        }
    }

    const columns: ColumnsType<EvaluationListTableDataType> = [
        {
            title: "Evaluation",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return <span>{index + 1}</span>
            },
        },
        {
            title: "testset",
            dataIndex: "testsetName",
            key: "testsetName",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "Variants",
            dataIndex: "variants",
            key: "variants",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <div>
                        {value.map((variant: Variant, index: number) => {
                            return (
                                <span>
                                    <span>{variant.variantName}</span>
                                    {index < value.length - 1 && <span> | </span>}
                                </span>
                            )
                        })}
                    </div>
                )
            },
        },
        {
            title: "Evaluation type",
            dataIndex: "evaluationType",
            key: "evaluationType",
            width: "300",
            render: (value: string) => {
                const evaluationType = EvaluationType[value as keyof typeof EvaluationType]
                const label = EvaluationTypeLabels[evaluationType]
                return <span>{label}</span>
            },
        },
        {
            title: "Created at",
            dataIndex: "createdAt",
            key: "createdAt",
            width: "300",
        },
        {
            title: "Action",
            dataIndex: "action",
            key: "action",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                let actionText = "Open evaluation"
                if (record.status !== EvaluationFlow.EVALUATION_FINISHED) {
                    actionText = "Continue evaluation"
                }
                return (
                    <div className="hover-button-wrapper">
                        <Button type="primary" onClick={() => onCompleteEvaluation(record)}>
                            {actionText}
                        </Button>
                    </div>
                )
            },
        },
    ]

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[], selectedRows: EvaluationListTableDataType[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const onDelete = async () => {
        const evaluationsIds = selectedRowKeys.map((key) => key.toString())
        setDeletingLoading(true)
        try {
            const deletedIds = await deleteEvaluations(evaluationsIds)
            setEvaluationsList((prevEvaluationsList) =>
                prevEvaluationsList.filter((evaluation) => !deletedIds.includes(evaluation.key)),
            )

            setSelectedRowKeys([])
        } catch (e) {
            console.log(e)
        } finally {
            setDeletingLoading(false)
        }
    }

    return (
        <div>
            <div style={{marginBottom: 40}}>
                <Button onClick={onDelete} disabled={selectedRowKeys.length == 0}>
                    <DeleteOutlined key="delete" style={{color: "red"}} />
                    Delete
                </Button>
            </div>

            <Table
                rowSelection={{
                    type: selectionType,
                    ...rowSelection,
                }}
                columns={columns}
                dataSource={evaluationsList}
                // loading={loading}
            />
        </div>
    )
}
