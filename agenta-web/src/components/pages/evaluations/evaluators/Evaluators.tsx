import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import EvaluatorCard from "./EvaluatorCard"
import {Button, Empty, Input, Space, Spin} from "antd"
import {PlusCircleOutlined} from "@ant-design/icons"
import NewEvaluatorModal from "./NewEvaluatorModal"
import {useAppId} from "@/hooks/useAppId"
import {fetchAllEvaluatorConfigs} from "@/services/evaluations"
import {useAtom} from "jotai"
import {evaluatorConfigsAtom} from "@/lib/atoms/evaluation"
import {JSSTheme} from "@/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        display: "flex",
        flexDirection: "column",
    },
    buttonsGroup: {
        justifyContent: "flex-end",
        width: "100%",
        padding: "1rem 0",
        position: "sticky",
        top: 46,
        zIndex: 1,
        backgroundColor: theme.colorBgContainer,
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))",
        gap: "1rem",
    },
}))

interface Props {}

const Evaluators: React.FC<Props> = () => {
    const classes = useStyles()
    const appId = useAppId()
    const [evaluatorConfigs, setEvaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [newEvalModalConfigOpen, setNewEvalModalConfigOpen] = useState(false)
    const [editIndex, setEditIndex] = useState<number>(-1)
    const [fetching, setFetching] = useState(false)
    const [searchTerm, setSearchTerm] = useState<string>("")

    const fetcher = () => {
        setFetching(true)
        fetchAllEvaluatorConfigs(appId)
            .then(setEvaluatorConfigs)
            .catch(console.error)
            .finally(() => setFetching(false))
    }

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
                {!fetching && !evaluatorConfigs.length ? (
                    <Empty description="No evaluators yet" style={{marginTop: "4rem"}} />
                ) : (
                    <div className={classes.grid}>
                        {filtered.map((item, ix) => (
                            <EvaluatorCard
                                key={item.id}
                                evaluatorConfig={item}
                                onEdit={() => {
                                    setEditIndex(ix)
                                    setNewEvalModalConfigOpen(true)
                                }}
                                onSuccessDelete={fetcher}
                            />
                        ))}
                    </div>
                )}
            </Spin>

            <NewEvaluatorModal
                open={newEvalModalOpen}
                onCancel={() => setNewEvalModalOpen(false)}
                onSuccess={() => {
                    setNewEvalModalOpen(false)
                    setNewEvalModalConfigOpen(false)
                    fetcher()
                }}
                newEvalModalConfigOpen={newEvalModalConfigOpen}
                setNewEvalModalConfigOpen={setNewEvalModalConfigOpen}
                setNewEvalModalOpen={setNewEvalModalOpen}
                editMode={editIndex !== -1}
                initialValues={evaluatorConfigs[editIndex]}
            />
        </div>
    )
}

export default Evaluators
