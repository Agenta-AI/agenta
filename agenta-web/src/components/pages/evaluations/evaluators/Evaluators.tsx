import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import EvaluatorCard from "./EvaluatorCard"
import {Button, Input, Space, Spin} from "antd"
import {PlusCircleOutlined} from "@ant-design/icons"
import {EvaluatorConfig} from "@/lib/Types"
import NewEvaluatorModal from "./NewEvaluatorModal"
import {useAppId} from "@/hooks/useAppId"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations"
import {useAtom} from "jotai"
import {evaluatorsAtom} from "@/lib/atoms/evaluation"

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
        gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))",
        gap: "1rem",
    },
})

interface Props {}

const Evaluators: React.FC<Props> = () => {
    const classes = useStyles()
    const appId = useAppId()
    const [evaluatorConfigs, setEvaluatorConfigs] = useState<EvaluatorConfig[]>([])
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [_, setEvaluators] = useAtom(evaluatorsAtom)
    const [editIndex, setEditIndex] = useState<number>(-1)
    const [fetching, setFetching] = useState(false)
    const [searchTerm, setSearchTerm] = useState<string>("")

    const fetcher = () => {
        setFetching(true)
        Promise.all([fetchAllEvaluatorConfigs(appId), fetchAllEvaluators()])
            .then(([configs, evaluators]) => {
                setEvaluatorConfigs(configs)
                setEvaluators(evaluators)
            })
            .catch(console.error)
            .finally(() => setFetching(false))
    }

    useEffect(() => {
        fetcher()
    }, [])

    const filtered = useMemo(() => {
        if (!searchTerm) return evaluatorConfigs
        return evaluatorConfigs.filter((item) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, evaluatorConfigs])

    return (
        <div className={classes.root}>
            <Space className={classes.buttonsGroup}>
                <Input.Search
                    onSearch={(term) => setSearchTerm(term)}
                    placeholder="Search"
                    allowClear
                    enterButton
                />
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
                    {filtered.map((item, ix) => (
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
