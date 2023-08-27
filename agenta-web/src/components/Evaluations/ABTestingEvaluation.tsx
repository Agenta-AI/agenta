import {deleteEvaluations, loadEvaluations} from "@/lib/services/api"
import {Button, Collapse, Table, Typography} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {ColumnsType} from "antd/es/table"
import {Variant} from "@/lib/Types"
import {DeleteOutlined} from "@ant-design/icons"
import {EvaluationTypeLabels} from "@/lib/helpers/utils"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {createUseStyles} from "react-jss"

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

const useStyles = createUseStyles({
    container: {
        marginBottom: 20,
        "& svg": {
            color: "red",
        },
    },
    collapse: {
        padding: 0,
        width: "100%",
    },
})

const {Title} = Typography

export default function ABTestingEvaluation() {
    const router = useRouter()
    const [evaluationsList, setEvaluationsList] = useState<EvaluationListTableDataType[]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectionType, setSelectionType] = useState<"checkbox" | "radio">("checkbox")
    const [deletingLoading, setDeletingLoading] = useState<boolean>(true)
    const classes = useStyles()

    const app_name = router.query.app_name?.toString() || ""

    useEffect(() => {
        if (!app_name) {
            return
        }
        const fetchEvaluations = async () => {
            try {
                const result = await loadEvaluations(app_name)
                let newList = result
                    .filter((obj: any) => obj.evaluationType === "human_a_b_testing")
                    .map((obj: any) => {
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

        if (evaluationType === EvaluationType.human_a_b_testing) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/human_a_b_testing`)
        }
    }

    const columns: ColumnsType<EvaluationListTableDataType> = [
        {
            title: "Variant 1",
            dataIndex: "variants",
            key: "variants",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <div>
                        <span>{value[0].variantName}</span>
                    </div>
                )
            },
        },
        {
            title: "Variant 2",
            dataIndex: "variants",
            key: "variants",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <div>
                        <span>{value[1].variantName}</span>
                    </div>
                )
            },
        },
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "v1 better",
        },
        {
            title: "v2 better",
        },
        {
            title: "Flag",
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

    const items = [
        {
            key: "1",
            label: (
                <div className={classes.container}>
                    <Title level={3}>Results A/B testing</Title>
                </div>
            ),
            children: (
                <div>
                    <div className={classes.container}>
                        <Button onClick={onDelete} disabled={selectedRowKeys.length == 0}>
                            <DeleteOutlined key="delete" />
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
            ),
        },
    ]

    return (
        <Collapse
            items={items}
            ghost
            bordered={false}
            expandIconPosition="end"
            className={classes.collapse}
            collapsible="icon"
            defaultActiveKey={["1"]}
        />
    )
}
