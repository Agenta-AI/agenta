import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import EvaluatorCard from "./EvaluatorCard"
import {Button, Space, Spin} from "antd"
import {PlusCircleOutlined} from "@ant-design/icons"
import {EvaluatorConfig} from "@/lib/Types"
import NewEvaluatorModal from "./NewEvaluatorModal"
import {useAppId} from "@/hooks/useAppId"
import {fetchAllEvaluatorConfigs} from "@/services/evaluations"

const useStyles = createUseStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
    },
    buttonsGroup: {
        alignSelf: "flex-end",
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 320px))",
        gap: "1rem",
    },
})

interface Props {}

const Evaluators: React.FC<Props> = () => {
    const classes = useStyles()
    const appId = useAppId()
    const [evaluatorConfigs, setEvaluatorConfigs] = useState<EvaluatorConfig[]>([])
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [editIndex, setEditIndex] = useState<number>(-1)
    const [fetching, setFetching] = useState(false)

    const fetcher = () => {
        setFetching(true)
        fetchAllEvaluatorConfigs(appId)
            .then(setEvaluatorConfigs)
            .catch(console.error)
            .finally(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [])

    return (
        <div className={classes.root}>
            <Space className={classes.buttonsGroup}>
                <Button
                    icon={<PlusCircleOutlined />}
                    type="primary"
                    onClick={() => {
                        setEditIndex(-1)
                        setNewEvalModalOpen(true)
                    }}
                >
                    New Evaluator
                </Button>
            </Space>
            <Spin spinning={fetching}>
                <div className={classes.grid}>
                    {evaluatorConfigs.map((item, ix) => (
                        <EvaluatorCard
                            key={item.id}
                            evaluatorConfig={item}
                            onEdit={() => {
                                setEditIndex(ix)
                                setNewEvalModalOpen(true)
                            }}
                            onSuccessDelete={fetcher}
                        />
                    ))}
                </div>
            </Spin>

            <NewEvaluatorModal
                open={newEvalModalOpen}
                onCancel={() => setNewEvalModalOpen(false)}
                onSuccess={() => {
                    setNewEvalModalOpen(false)
                    fetcher()
                }}
                editMode={editIndex !== -1}
                initialValues={evaluatorConfigs[editIndex]}
            />
        </div>
    )
}

export default Evaluators
