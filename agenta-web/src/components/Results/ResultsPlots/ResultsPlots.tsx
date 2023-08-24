import {ResultsTableDataType} from "@/lib/Types"

export const renderPlotForABTestEvaluation = (
    votesData: any,
    variants: string[],
    index: number,
    record: ResultsTableDataType,
) => {
    const hexColors = ["#5B8FF9", "#61DDAA", "#FFbcb8"]

    let flagDiv = null
    if (
        record?.votesData?.flag_votes?.number_of_votes &&
        record?.votesData?.flag_votes?.number_of_votes > 0
    ) {
        flagDiv = (
            <div
                key={`flag-${index}`}
                style={{
                    width: `${record.votesData.flag_votes.percentage * 100}%`,
                    backgroundColor: hexColors[hexColors.length - 1],
                    textAlign: "center",
                    padding: "2px 10px",
                }}
            >{`Flag: ${record.votesData.flag_votes.number_of_votes} votes (${record.votesData.flag_votes.percentage}%)`}</div>
        )
    }

    return (
        <div
            style={{
                display: "flex",
                maxHeight: "50px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {variants.map((cell, index) => {
                const variantsVotesData = votesData.variants_votes_data[cell]
                if (!variantsVotesData || variantsVotesData.number_of_votes === 0) return null
                return (
                    <div
                        key={`variant-${index}`}
                        style={{
                            padding: "2px 10px",
                            color: "#fff",
                            width: `${variantsVotesData.percentage * 100}%`,
                            backgroundColor: hexColors[index],
                            textAlign: "center",
                        }}
                    >
                        {`${cell} : ${variantsVotesData.number_of_votes} votes (${variantsVotesData.percentage}%)`}
                    </div>
                )
            })}
            {flagDiv}
        </div>
    )
}

export const renderPlotForExactMatchEvaluation = (
    scoresData: any,
    variants: string[],
    index: number,
    record: ResultsTableDataType,
) => {
    const hexColors = ["#5B8FF9", "#61DDAA", "#FFbcb8"]

    return (
        <div
            style={{
                display: "flex",
                maxHeight: "50px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {scoresData.scores.wrong > 0 && (
                <div
                    key={`variant-wrong-${index}`}
                    style={{
                        padding: "2px 10px",
                        color: "#fff",
                        width: `${(scoresData.scores.wrong / scoresData.nb_of_rows) * 100}%`,
                        backgroundColor: "#CF6068",
                        textAlign: "center",
                    }}
                >
                    {scoresData.scores.wrong} Wrong Answers
                </div>
            )}

            {scoresData.scores.correct > 0 && (
                <div
                    key={`variant-correct-${index}`}
                    style={{
                        padding: "2px 10px",
                        color: "#fff",
                        width: `${(scoresData.scores.correct / scoresData.nb_of_rows) * 100}%`,
                        backgroundColor: "#8EBE64",
                        textAlign: "center",
                    }}
                >
                    {scoresData.scores.correct} Correct Answers
                </div>
            )}
        </div>
    )
}

export const renderPlotForSimilarityMatchEvaluation = (
    scoresData: any,
    variants: string[],
    index: number,
    record: ResultsTableDataType,
) => {
    const hexColors = ["#5B8FF9", "#61DDAA", "#FFbcb8"]

    return (
        <div
            style={{
                display: "flex",
                maxHeight: "50px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }}
        >
            {scoresData.scores.false > 0 && (
                <div
                    key={`variant-dissimilar-${index}`}
                    style={{
                        padding: "2px 10px",
                        color: "#fff",
                        width: `${(scoresData.scores.false / scoresData.nb_of_rows) * 100}%`,
                        backgroundColor: "#CF6068",
                        textAlign: "center",
                    }}
                >
                    {scoresData.scores.false} Dissimilar Answers
                </div>
            )}

            {scoresData.scores.true > 0 && (
                <div
                    key={`variant-similar-${index}`}
                    style={{
                        padding: "2px 10px",
                        color: "#fff",
                        width: `${(scoresData.scores.true / scoresData.nb_of_rows) * 100}%`,
                        backgroundColor: "#8EBE64",
                        textAlign: "center",
                    }}
                >
                    {scoresData.scores.true} Similar Answers
                </div>
            )}
        </div>
    )
}
