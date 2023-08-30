import {useState, useEffect} from "react"
import {Table, Spin, Tag, Progress} from "antd"
import {ColumnsType} from "antd/es/table"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {EvaluationResponseType, ResultsTableDataType} from "@/lib/Types"
import {useRouter} from "next/router"
import {EvaluationType} from "@/lib/enums"
import {
    renderPlotForABTestEvaluation,
    renderPlotForExactMatchEvaluation,
    renderPlotForSimilarityMatchEvaluation,
} from "./ResultsPlots/ResultsPlots"

interface Vote {
    [key: string]: number
}

const fetchData = async (url: string): Promise<any> => {
    const response = await fetch(url)
    console.log(response)
    return response.json()
}

const Results: React.FC = () => {
    const router = useRouter()
    const [data, setData] = useState<ResultsTableDataType[]>([])
    const [loading, setLoading] = useState<boolean>(true)

    const appName = router.query.app_name?.toString() || ""

    useEffect(() => {
        // TODO: move to api.ts
        setLoading(true)
        fetchData(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations?app_name=${appName}`)
            .then((responseData) => {
                const fetchPromises: Promise<ResultsTableDataType>[] = responseData.map(
                    (item: EvaluationResponseType) => {
                        return fetchData(
                            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${item.id}/results`,
                        )
                            .then((results) => {
                                if (item.evaluation_type === EvaluationType.human_a_b_testing) {
                                    if (Object.keys(results.votes_data).length > 0) {
                                        return {
                                            id: item.id,
                                            createdAt: formatDate(item.created_at),
                                            variants: item.variants,
                                            votesData: results.votes_data,
                                            evaluationType: item.evaluation_type,
                                        }
                                    }
                                } else if (
                                    item.evaluation_type == EvaluationType.auto_exact_match ||
                                    item.evaluation_type == EvaluationType.auto_similarity_match
                                ) {
                                    if (Object.keys(results.scores_data).length > 0) {
                                        return {
                                            id: item.id,
                                            createdAt: formatDate(item.created_at),
                                            variants: item.variants,
                                            scoresData: results.scores_data,
                                            evaluationType: item.evaluation_type,
                                        }
                                    }
                                }
                            })
                            .catch((err) => {
                                console.error(err)
                            })
                    },
                )

                Promise.all(fetchPromises)
                    .then((evaluations) => {
                        // Filter out any evaluations that are undefined due to not having votes data
                        const validEvaluations = evaluations.filter(
                            (evaluation) => evaluation !== undefined,
                        )
                        setData(validEvaluations)
                        setLoading(false)
                    })
                    .catch((err) => {
                        console.error(err)
                        setLoading(false)
                    })
            })
            .catch((err) => {
                console.error(err)
                setLoading(false)
            })
    }, [appName])

    const columns: ColumnsType<ResultsTableDataType> = [
        {
            title: "Variants",
            dataIndex: "variants",
            key: "variants",
        },
        {
            title: "Evaluation results",
            dataIndex: "votesData",
            key: "votesData",
            width: "70%",
            render: (value: any, record: ResultsTableDataType, index: number) => {
                const variants = data[index].variants
                if (data[index].evaluationType == EvaluationType.human_a_b_testing) {
                    return renderPlotForABTestEvaluation(record.votesData, variants, index, record)
                } else if (data[index].evaluationType == EvaluationType.auto_exact_match) {
                    return renderPlotForExactMatchEvaluation(
                        record.scoresData,
                        variants,
                        index,
                        record,
                    )
                } else if (data[index].evaluationType == EvaluationType.auto_similarity_match) {
                    return renderPlotForSimilarityMatchEvaluation(
                        record.scoresData,
                        variants,
                        index,
                        record,
                    )
                }
            },
        },
        {
            title: "Created at",
            dataIndex: "createdAt",
            key: "createdAt",
            width: "300",
        },
    ]

    return (
        <div>
            {loading ? <Spin /> : <Table columns={columns} dataSource={data} loading={loading} />}
        </div>
    )
}
export default Results
