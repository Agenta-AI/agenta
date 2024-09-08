import {evaluatorsAtom} from "@/lib/atoms/evaluation"
import {Evaluator, EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {Copy, Note, Trash} from "@phosphor-icons/react"
import {Button, Card, Dropdown, Tag, Typography} from "antd"
import {useAtom} from "jotai"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import DeleteModal from "./DeleteModal"

interface EvaluatorCardProps {
    evaluatorConfigs: EvaluatorConfig[]
    setEditMode: React.Dispatch<React.SetStateAction<boolean>>
    setCloneConfig: React.Dispatch<React.SetStateAction<boolean>>
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setEditEvalEditValues: React.Dispatch<React.SetStateAction<EvaluatorConfig | null>>
    onSuccess: () => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingLG,
        height: 600,
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
        "&:hover": {},
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
    const [selectedDelEval, setSelectedDelEval] = useState<EvaluatorConfig | null>(null)

    const formatEvluatorConfigs = Object.entries(
        evaluatorConfigs.reduce(
            (acc, curr) => {
                if (!acc[curr.evaluator_key]) {
                    acc[curr.evaluator_key] = []
                }
                acc[curr.evaluator_key].push(curr)
                return acc
            },
            {} as Record<string, EvaluatorConfig[]>,
        ),
    ).map(([title, items]) => ({
        title,
        items,
    }))

    return (
        <div className={classes.container}>
            {formatEvluatorConfigs.map(({title, items}) => (
                <div className="flex flex-col gap-2" key={title}>
                    <Typography.Text className={classes.cardTitle}>{title}</Typography.Text>
                    <div className="flex gap-4">
                        {items.map((item) => {
                            const evaluator = evaluators.find((e) => e.key === item.evaluator_key)

                            return (
                                <Card
                                    key={item.id}
                                    className={classes.evaluatorCard}
                                    onClick={() => {
                                        const selectedEval = evaluators.find(
                                            (e) => e.key === item.evaluator_key,
                                        )
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
                                            placement="bottomCenter"
                                            overlayStyle={{width: 180}}
                                            menu={{
                                                items: [
                                                    {
                                                        key: "view_config",
                                                        label: "View configuration",
                                                        icon: <Note size={16} />,
                                                        onClick: (e: any) => {
                                                            e.domEvent.stopPropagation()
                                                            const selectedEval = evaluators.find(
                                                                (e) => e.key === item.evaluator_key,
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
                                                                (e) => e.key === item.evaluator_key,
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
                                        <Typography.Text>Version</Typography.Text>
                                        <Typography.Text type="secondary">v1.1</Typography.Text>
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                </div>
            ))}

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
