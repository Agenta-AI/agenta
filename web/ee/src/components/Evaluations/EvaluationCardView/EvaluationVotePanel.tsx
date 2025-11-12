import {StarFilled} from "@ant-design/icons"
import {Button, ConfigProvider, InputNumber, Rate, Spin, Typography, theme} from "antd"
import {createUseStyles} from "react-jss"

import {Variant} from "@/oss/lib/Types"

import {VARIANT_COLORS} from "./assets/styles"

const useStyles = createUseStyles({
    root: {
        display: "flex",
        justifyContent: "center",
        width: "100%",
    },
    btnRow: {
        display: "flex",
        gap: "0.5rem",
    },
    gradeRoot: {
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
    },
    variantName: {
        display: "inline-block",
        marginBottom: "0.25rem",
    },
    btnsDividerHorizontal: {
        height: 30,
        borderRight: "1.2px solid",
        alignSelf: "center",
        margin: "0 4px",
    },
    btnsDividerVertical: {
        width: 120,
        borderBottom: "1.2px solid",
        alignSelf: "center",
        margin: "4px 0",
    },
})

interface CommonProps<T> {
    onChange: (value: T) => void
    value?: T
    vertical?: boolean
}

type BinaryVoteProps = CommonProps<boolean>

const BinaryVote: React.FC<BinaryVoteProps> = ({onChange, value, vertical}) => {
    const classes = useStyles()

    const getOnClick = (isGood: boolean) => () => {
        onChange(isGood)
    }

    return (
        <div className={classes.btnRow} style={{flexDirection: vertical ? "column" : undefined}}>
            <Button onClick={getOnClick(true)} type={value === true ? "primary" : undefined}>
                Good
            </Button>
            <Button
                onClick={getOnClick(false)}
                type={!value === false ? "primary" : undefined}
                danger
            >
                Bad
            </Button>
        </div>
    )
}

type ComparisonVoteProps = {
    variants: Variant[]
    outputs: any
} & CommonProps<string>

const ComparisonVote: React.FC<ComparisonVoteProps> = ({
    variants,
    onChange,
    value,
    vertical,
    outputs,
}) => {
    const classes = useStyles()
    const {token} = theme.useToken()
    const badId = "0"
    const goodId = "1"

    const getOnClick = (variantId: string) => () => {
        onChange(variantId)
    }

    return (
        <div className={classes.btnRow} style={{flexDirection: vertical ? "column" : undefined}}>
            {variants.map((variant, ix) => (
                <ConfigProvider
                    key={`${variant.variantId}-${ix}`}
                    theme={{
                        components: {
                            Button: {
                                colorError: VARIANT_COLORS[ix],
                                colorErrorHover: VARIANT_COLORS[ix],
                                colorErrorBorderHover: VARIANT_COLORS[ix],
                                colorErrorActive: VARIANT_COLORS[ix],
                            },
                        },
                    }}
                >
                    <Button
                        onClick={getOnClick(variant.variantId)}
                        type={value === variant.variantId ? "primary" : undefined}
                        danger
                        disabled={!outputs?.length}
                    >
                        {String.fromCharCode(65 + ix)}: {variant.variantName}
                    </Button>
                </ConfigProvider>
            ))}
            <div
                className={vertical ? classes.btnsDividerVertical : classes.btnsDividerHorizontal}
                style={{borderColor: token.colorBorder}}
            />
            <ConfigProvider
                theme={{
                    components: {
                        Button: {
                            colorError: VARIANT_COLORS[2],
                            colorErrorBorderHover: VARIANT_COLORS[2],
                            colorErrorHover: VARIANT_COLORS[2],
                            colorErrorActive: VARIANT_COLORS[2],
                        },
                    },
                }}
            >
                <Button
                    danger
                    type={value === goodId ? "primary" : undefined}
                    key={goodId}
                    onClick={getOnClick(goodId)}
                    disabled={!outputs?.length}
                >
                    Both are good
                </Button>
            </ConfigProvider>
            <Button
                danger
                type={value === badId ? "primary" : undefined}
                key={badId}
                onClick={getOnClick(badId)}
                disabled={!outputs?.length}
            >
                Both are bad
            </Button>
        </div>
    )
}

type GradingVoteProps = {
    variants: Variant[]
    maxGrade?: number
} & CommonProps<
    {
        grade: number | null
        variantId: string
    }[]
>

const GradingVote: React.FC<GradingVoteProps> = ({
    variants,
    onChange,
    value = [],
    maxGrade = 5,
    vertical,
}) => {
    const classes = useStyles()

    const getOnClick = (variantId: string, grade: number) => () => {
        onChange(
            variants.map((variant) => ({
                variantId: variant.variantId,
                grade: variant.variantId === variantId ? grade : null,
            })),
        )
    }

    return (
        <div className={classes.gradeRoot}>
            {variants.map((variant, ix) => (
                <div key={`${variant.variantId}-${ix}`}>
                    <Typography.Text className={classes.variantName} strong>
                        {variant.variantName}
                    </Typography.Text>
                    <div
                        className={classes.btnRow}
                        style={{flexDirection: vertical ? "column" : undefined}}
                    >
                        {Array.from({length: maxGrade}, (_, i) => i + 1).map((grade) => (
                            <Button
                                key={grade + ""}
                                onClick={getOnClick(variant.variantId, grade)}
                                type={
                                    value.find((item) => item.variantId === variant.variantId)
                                        ?.grade === grade
                                        ? "primary"
                                        : undefined
                                }
                            >
                                {grade}
                            </Button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

type NumericScoreVoteProps = {
    variants: Variant[]
    min?: number
    max?: number
    showVariantName?: boolean
    outputs: any
} & CommonProps<
    {
        score: number | null
        variantId: string
    }[]
>

const NumericScoreVote: React.FC<NumericScoreVoteProps> = ({
    variants,
    onChange,
    value = [],
    min = 0,
    max = 100,
    vertical,
    showVariantName = true,
    outputs,
}) => {
    const classes = useStyles()

    const _onChange = (variantId: string, score: number | null) => {
        onChange(
            variants.map((variant) => ({
                variantId: variant.variantId,
                score: variant.variantId === variantId ? score : null,
            })),
        )
    }

    return (
        <div className={classes.gradeRoot}>
            {variants.map((variant, ix) => (
                <div key={`${variant.variantId}-${ix}`}>
                    {showVariantName && (
                        <Typography.Text className={classes.variantName} strong>
                            {variant.variantName}
                        </Typography.Text>
                    )}
                    <div
                        className={classes.btnRow}
                        style={{
                            flexDirection: vertical ? "column" : undefined,
                            alignItems: "center",
                        }}
                    >
                        <InputNumber
                            defaultValue={
                                value.find((item) => item.variantId === variant.variantId)?.score ??
                                undefined
                            }
                            min={min}
                            max={max}
                            onChange={(score) => _onChange(variant.variantId, score)}
                            disabled={!outputs?.length}
                        />
                        <Typography.Text>/ {max}</Typography.Text>
                    </div>
                </div>
            ))}
        </div>
    )
}

type RatingVoteProps = NumericScoreVoteProps

const RatingVote: React.FC<RatingVoteProps> = ({
    variants,
    onChange,
    value = [],
    vertical,
    showVariantName = true,
    outputs,
}) => {
    const classes = useStyles()

    const _onChange = (variantId: string, score: number | null) => {
        onChange(
            variants.map((variant) => ({
                variantId: variant.variantId,
                score: variant.variantId === variantId ? score : null,
            })),
        )
    }

    return (
        <div className={classes.gradeRoot}>
            {variants.map((variant, ix) => {
                const score = value.find((item) => item.variantId === variant.variantId)?.score
                const finalValue = typeof score !== "number" ? null : score / 25 + 1

                return (
                    <div key={`${variant.variantId}-${ix}`}>
                        {showVariantName && (
                            <Typography.Text className={classes.variantName} strong>
                                {variant.variantName}
                            </Typography.Text>
                        )}
                        <div
                            className={classes.btnRow}
                            style={{
                                flexDirection: vertical ? "column" : undefined,
                                alignItems: "center",
                            }}
                        >
                            <Rate
                                defaultValue={finalValue || undefined}
                                tooltips={["0%", "25%", "50%", "75%", "100%"]}
                                allowClear={false}
                                character={({index = 0, value = 0}) => {
                                    const rateColors: Record<number, string> = {
                                        1: "#D61010",
                                        2: "#FFA940",
                                        3: "#FADB14",
                                        4: "#BAE637",
                                        5: "#73D13D",
                                    }

                                    return (
                                        <StarFilled
                                            style={{
                                                color:
                                                    value > index
                                                        ? rateColors[value] || "#d9d9d9"
                                                        : "#d9d9d9",
                                            }}
                                        />
                                    )
                                }}
                                onChange={(score) => {
                                    const finalScore = (score - 1) * 25
                                    _onChange(variant.variantId, finalScore)
                                }}
                                disabled={!outputs?.length}
                            />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

type Props =
    | ({
          type: "binary"
      } & BinaryVoteProps)
    | ({
          type: "comparison"
      } & ComparisonVoteProps)
    | ({
          type: "grading"
      } & GradingVoteProps)
    | ({
          type: "numeric"
      } & NumericScoreVoteProps)
    | ({
          type: "rating"
      } & RatingVoteProps)

const EvaluationVotePanel: React.FC<Props & {loading?: boolean}> = ({type, loading, ...props}) => {
    const classes = useStyles()

    return (
        <div className={classes.root}>
            <Spin spinning={loading}>
                {type === "binary" ? (
                    <BinaryVote {...(props as BinaryVoteProps)} />
                ) : type === "comparison" ? (
                    <ComparisonVote {...(props as ComparisonVoteProps)} />
                ) : type === "grading" ? (
                    <GradingVote {...(props as GradingVoteProps)} />
                ) : type === "rating" ? (
                    <RatingVote {...(props as RatingVoteProps)} />
                ) : (
                    <NumericScoreVote {...(props as NumericScoreVoteProps)} />
                )}
            </Spin>
        </div>
    )
}

export default EvaluationVotePanel
