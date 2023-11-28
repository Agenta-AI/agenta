import {Variant} from "@/lib/Types"
import {Button, ConfigProvider, InputNumber, Spin, Typography, theme} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import {VARIANT_COLORS} from "."

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
} & CommonProps<string>

const ComparisonVote: React.FC<ComparisonVoteProps> = ({variants, onChange, value, vertical}) => {
    const classes = useStyles()
    const {token} = theme.useToken()
    const badId = "0"

    const getOnClick = (variantId: string) => () => {
        onChange(variantId)
    }

    return (
        <div className={classes.btnRow} style={{flexDirection: vertical ? "column" : undefined}}>
            {variants.map((variant, ix) => (
                <ConfigProvider
                    key={variant.variantId}
                    theme={{token: {colorError: VARIANT_COLORS[ix]}}}
                >
                    <Button
                        onClick={getOnClick(variant.variantId)}
                        type={value === variant.variantId ? "primary" : undefined}
                        danger
                    >
                        {String.fromCharCode(65 + ix)}: {variant.variantName}
                    </Button>
                </ConfigProvider>
            ))}
            <div
                className={vertical ? classes.btnsDividerVertical : classes.btnsDividerHorizontal}
                style={{borderColor: token.colorBorder}}
            />
            <Button
                danger
                type={value === badId ? "primary" : undefined}
                key={badId}
                onClick={getOnClick(badId)}
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
            {variants.map((variant) => (
                <div key={variant.variantId}>
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
            {variants.map((variant) => (
                <div key={variant.variantId}>
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
                                value.find((item) => item.variantId === variant.variantId)?.score ||
                                undefined
                            }
                            min={min}
                            max={max}
                            onChange={(score) => _onChange(variant.variantId, score)}
                        />
                        <Typography.Text>/ {max}</Typography.Text>
                    </div>
                </div>
            ))}
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
                ) : (
                    <NumericScoreVote {...(props as NumericScoreVoteProps)} />
                )}
            </Spin>
        </div>
    )
}

export default EvaluationVotePanel
