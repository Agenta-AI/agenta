import {JSSTheme} from "@/lib/Types"
import {PlusCircleOutlined, SlidersOutlined} from "@ant-design/icons"
import {Button, Empty, Space, Tooltip, Typography} from "antd"
import Image from "next/image"
import React from "react"
import {createUseStyles} from "react-jss"
import evaluationIllustration from "@/media/eval-illustration.png"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    emptyRoot: {
        height: "calc(100vh - 260px)",
        display: "grid",
        placeItems: "center",
    },
    empty: {
        "& .ant-empty-description": {
            fontSize: 18,
            marginTop: "0.75rem",
            marginBottom: "1.5rem",
        },
    },
    emptyImg: {
        width: 120,
        height: 120,
        objectFit: "contain",
        filter: theme.isDark ? "invert(1)" : "none",
        opacity: 0.85,
    },
}))

interface Props {
    onConfigureEvaluators?: () => void
    onBeginEvaluation?: () => void
}

const EmptyEvaluations: React.FC<Props> = ({onConfigureEvaluators, onBeginEvaluation}) => {
    const classes = useStyles()

    return (
        <div className={classes.emptyRoot}>
            <Empty
                className={classes.empty}
                description={
                    <span>
                        Welcome to the evaluation setup!
                        <br />
                        Are you ready to get started?
                    </span>
                }
                image={
                    <Image
                        className={classes.emptyImg}
                        alt="no evaluation illustration"
                        src={evaluationIllustration}
                    />
                }
            >
                <Space direction="vertical">
                    <Tooltip title="Select and customize evaluators such as custom code or regex evaluators.">
                        <Button
                            size="large"
                            icon={<SlidersOutlined />}
                            type="primary"
                            onClick={onConfigureEvaluators}
                        >
                            Configure Your Evaluators
                        </Button>
                    </Tooltip>
                    <Typography.Text>Or</Typography.Text>
                    <Tooltip
                        title="Choose your variants and evaluators to start the evaluation process."
                        placement="bottom"
                    >
                        <Button
                            size="large"
                            icon={<PlusCircleOutlined />}
                            type="default"
                            onClick={onBeginEvaluation}
                        >
                            Begin Evaluation Now
                        </Button>
                    </Tooltip>
                </Space>
            </Empty>
        </div>
    )
}

export default EmptyEvaluations
