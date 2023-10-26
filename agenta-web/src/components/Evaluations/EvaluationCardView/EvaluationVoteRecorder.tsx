import {Variant} from "@/lib/Types"
import {Button, ConfigProvider, Spin, Typography, theme} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import {VARIANT_COLORS} from "."

const useStyles = createUseStyles({
    voteRecorder: {
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
    btnsDivider: {
        height: 30,
        borderRight: "1.2px solid",
        alignSelf: "center",
        margin: "0 4px",
    },
})

interface CommonProps<T> {
    onChange: (value: T) => void
    value?: T
}

type BinaryVoteProps = CommonProps<boolean>

const BinaryVote: React.FC<BinaryVoteProps> = ({onChange, value}) => {
    const classes = useStyles()

    const getOnClick = (isGood: boolean) => () => {
        onChange(isGood)
    }

    return (
        <div className={classes.btnRow}>
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

const ComparisonVote: React.FC<ComparisonVoteProps> = ({variants, onChange, value}) => {
    const classes = useStyles()
    const {token} = theme.useToken()
    const badId = "0"

    const getOnClick = (variantId: string) => () => {
        onChange(variantId)
    }

    return (
        <div className={classes.btnRow}>
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
            <div className={classes.btnsDivider} style={{borderRightColor: token.colorBorder}} />
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
                    <div className={classes.btnRow}>
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

const EvaluationVoteRecorder: React.FC<Props & {loading?: boolean}> = ({
    type,
    loading,
    ...props
}) => {
    const classes = useStyles()

    return (
        <div className={classes.voteRecorder}>
            <Spin spinning={loading}>
                {type === "binary" ? (
                    <BinaryVote {...(props as BinaryVoteProps)} />
                ) : type === "comparison" ? (
                    <ComparisonVote {...(props as ComparisonVoteProps)} />
                ) : (
                    <GradingVote {...(props as GradingVoteProps)} />
                )}
            </Spin>
        </div>
    )
}

export default EvaluationVoteRecorder
