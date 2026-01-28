import {useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {Copy, Note, Trash} from "@phosphor-icons/react"
import {Button, Card, Dropdown, Empty, Tag, Typography} from "antd"
import {useAtom} from "jotai"
import {createUseStyles} from "react-jss"

import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {Evaluator, JSSTheme, SimpleEvaluator} from "@/oss/lib/Types"

import DeleteModal from "./DeleteModal"

interface EvaluatorCardProps {
    evaluatorConfigs: SimpleEvaluator[]
    setEditMode: React.Dispatch<React.SetStateAction<boolean>>
    setCloneConfig: React.Dispatch<React.SetStateAction<boolean>>
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setEditEvalEditValues: React.Dispatch<React.SetStateAction<SimpleEvaluator | null>>
    onSuccess: () => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexWrap: "wrap",
        gap: theme.padding,
        height: "100%",
        maxHeight: 600,
        overflowY: "auto",
    },
    cardTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    evaluatorCard: {
        width: 276,
        display: "flex",
        height: "fit-content",
        flexDirection: "column",
        transition: "all 0.025s ease-in",
        cursor: "pointer",
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,

            "& .ant-card-head-title": {
                fontSize: theme.fontSize,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeight,
            },
        },
        "& > .ant-card-body": {
            padding: theme.paddingSM,
            display: "flex",
            flexDirection: "column",
            gap: theme.marginXS,
            "& div": {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
            },
        },
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
        },
    },
    centeredItem: {
        display: "grid",
        placeItems: "center",
        width: "100%",
        height: 600,
    },
}))

const EvaluatorCard = ({
    evaluatorConfigs,
    setEditMode,
    setCurrent,
    setSelectedEvaluator,
    setEditEvalEditValues,
    onSuccess,
    setCloneConfig,
}: EvaluatorCardProps) => {
    const classes = useStyles()
    const evaluators = useAtom(evaluatorsAtom)[0]
    const [openDeleteModal, setOpenDeleteModal] = useState(false)
    const [selectedDelEval, setSelectedDelEval] = useState<SimpleEvaluator | null>(null)

    return (
        <div className={classes.container}>
            {evaluatorConfigs.length ? (
                evaluatorConfigs.map((item) => {
                    const evaluatorKey = resolveEvaluatorKey(item)
                    const evaluator = evaluators.find((e) => e.key === evaluatorKey)

                    return (
                        <Card
                            key={item.id}
                            className={classes.evaluatorCard}
                            onClick={() => {
                                const selectedEval = evaluators.find((e) => e.key === evaluatorKey)
                                if (selectedEval) {
                                    setEditMode(true)
                                    setSelectedEvaluator(selectedEval)
                                    setEditEvalEditValues(item)
                                    setCurrent(2)
                                }
                            }}
                            title={item.name}
                            extra={
                                <Dropdown
                                    trigger={["click"]}
                                    placement="bottomRight"
                                    styles={{
                                        root: {
                                            width: 180,
                                        },
                                    }}
                                    menu={{
                                        items: [
                                            {
                                                key: "view_config",
                                                label: "View configuration",
                                                icon: <Note size={16} />,
                                                onClick: (e: any) => {
                                                    e.domEvent.stopPropagation()
                                                    const selectedEval = evaluators.find(
                                                        (e) => e.key === evaluatorKey,
                                                    )
                                                    if (selectedEval) {
                                                        setEditMode(true)
                                                        setSelectedEvaluator(selectedEval)
                                                        setEditEvalEditValues(item)
                                                        setCurrent(2)
                                                    }
                                                },
                                            },
                                            {
                                                key: "clone",
                                                label: "Clone",
                                                icon: <Copy size={16} />,
                                                onClick: (e: any) => {
                                                    e.domEvent.stopPropagation()
                                                    const selectedEval = evaluators.find(
                                                        (e) => e.key === evaluatorKey,
                                                    )
                                                    if (selectedEval) {
                                                        setCloneConfig(true)
                                                        setSelectedEvaluator(selectedEval)
                                                        setEditEvalEditValues(item)
                                                        setCurrent(2)
                                                    }
                                                },
                                            },
                                            {type: "divider"},
                                            {
                                                key: "delete_app",
                                                label: "Delete",
                                                icon: <Trash size={16} />,
                                                danger: true,
                                                onClick: (e: any) => {
                                                    e.domEvent.stopPropagation()
                                                    setOpenDeleteModal(true)
                                                    setSelectedDelEval(item)
                                                },
                                            },
                                        ],
                                    }}
                                >
                                    <Button
                                        type="text"
                                        onClick={(e) => e.stopPropagation()}
                                        icon={<MoreOutlined />}
                                        size="small"
                                    />
                                </Dropdown>
                            }
                        >
                            <div>
                                <Typography.Text>Type</Typography.Text>
                                <Tag color={item.color} className="mr-0">
                                    {evaluator?.name}
                                </Tag>
                            </div>
                            <div>
                                <Typography.Text>Date Modified</Typography.Text>
                                <Typography.Text type="secondary">
                                    {formatDay({date: item.updated_at})}
                                </Typography.Text>
                            </div>
                        </Card>
                    )
                })
            ) : (
                <div className={classes.centeredItem}>
                    <Empty description="Evaluation not found" />
                </div>
            )}

            {selectedDelEval && (
                <DeleteModal
                    open={openDeleteModal}
                    onCancel={() => setOpenDeleteModal(false)}
                    selectedEvalConfig={selectedDelEval}
                    onSuccess={onSuccess}
                />
            )}
        </div>
    )
}

export default EvaluatorCard
