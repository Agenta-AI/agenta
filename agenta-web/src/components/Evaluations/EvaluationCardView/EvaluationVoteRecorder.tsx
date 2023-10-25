import {Variant} from "@/lib/Types"
import {Button, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    voteRecorder: {
        display: "flex",
        justifyContent: "flex-end",
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
})

interface BinaryVoteProps {
    onChange: (isGood: boolean) => void
    value?: boolean
}

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

interface ComparisonVoteProps {
    onChange: (variantId: string) => void
    value?: string
    variants: Variant[]
}

const ComparisonVote: React.FC<ComparisonVoteProps> = ({variants, onChange, value}) => {
    const classes = useStyles()

    const getOnClick = (variantId: string) => () => {
        onChange(variantId)
    }

    return (
        <div className={classes.btnRow}>
            {[...variants, {variantId: "0", variantName: "All are bad"}].map((variant) => (
                <Button
                    key={variant.variantId}
                    onClick={getOnClick(variant.variantId)}
                    type={value === variant.variantId ? "primary" : undefined}
                    danger={variant.variantId === "0"}
                >
                    {variant.variantName}
                </Button>
            ))}
        </div>
    )
}

type VariantGradeValue = {
    grade: number | null
    variantId: string
}
interface GradingVoteProps {
    onChange: (value: VariantGradeValue[]) => void
    value?: VariantGradeValue[]
    variants: Variant[]
    maxGrade?: number
}

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

const EvaluationVoteRecorder: React.FC<Props> = ({type, ...props}) => {
    const classes = useStyles()

    return (
        <div className={classes.voteRecorder}>
            {type === "binary" ? (
                <BinaryVote {...(props as BinaryVoteProps)} />
            ) : type === "comparison" ? (
                <ComparisonVote {...(props as ComparisonVoteProps)} />
            ) : (
                <GradingVote {...(props as GradingVoteProps)} />
            )}
        </div>
    )
}

export default EvaluationVoteRecorder
