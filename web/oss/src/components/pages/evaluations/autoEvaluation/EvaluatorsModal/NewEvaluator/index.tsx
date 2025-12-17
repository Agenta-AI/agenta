import {useMemo, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Divider, Flex, Input, Radio, Space, Typography} from "antd"
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import {getEvaluatorTags} from "@/oss/lib/evaluations/legacy"
import {Evaluator, JSSTheme} from "@/oss/lib/Types"
import {nonArchivedEvaluatorsAtom} from "@/oss/state/evaluators"

import NewEvaluatorList from "./NewEvaluatorList"

interface NewEvaluatorProps {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    handleOnCancel: () => void
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setEvaluatorsDisplay: any
    evaluatorsDisplay: string
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& .ant-typography": {
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
            lineHeight: theme.lineHeightLG,
        },
    },
    subTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    radioBtnContainer: {
        display: "flex",
        alignItems: "center",
        gap: theme.marginXS,
        "& .ant-radio-button-wrapper": {
            borderRadius: theme.borderRadius,
            borderInlineStartWidth: "1px",
            "&:before": {
                width: 0,
            },
            "&:not(.ant-radio-button-wrapper-checked)": {
                border: "none",
                "&:hover": {
                    backgroundColor: theme.colorBgTextHover,
                },
            },
        },
    },
}))

const NewEvaluator = ({
    setCurrent,
    handleOnCancel,
    setSelectedEvaluator,
    setEvaluatorsDisplay,
    evaluatorsDisplay,
}: NewEvaluatorProps) => {
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState("")
    const baseEvaluatorTags = getEvaluatorTags()
    const nonArchivedEvaluators = useAtomValue(nonArchivedEvaluatorsAtom)
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")

    // Filter tags to only show those that have evaluators
    const evaluatorTags = useMemo(() => {
        const tagsWithEvaluators = new Set<string>()
        nonArchivedEvaluators.forEach((item) => {
            item.tags.forEach((tag) => tagsWithEvaluators.add(tag))
        })
        return baseEvaluatorTags.filter((tag) => tagsWithEvaluators.has(tag.value))
    }, [baseEvaluatorTags, nonArchivedEvaluators])

    const filteredEvaluators = useMemo(() => {
        let filtered = nonArchivedEvaluators

        if (selectedEvaluatorCategory !== "view_all") {
            filtered = filtered.filter((item) => item.tags.includes(selectedEvaluatorCategory))
        }

        if (searchTerm) {
            filtered = filtered.filter((item) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }

        return filtered
    }, [searchTerm, selectedEvaluatorCategory, nonArchivedEvaluators])

    return (
        <div>
            <div className="flex flex-col gap-4">
                <div className={classes.title}>
                    <Space>
                        <Button
                            icon={<ArrowLeft size={14} />}
                            className="flex items-center justify-center"
                            onClick={() => setCurrent(0)}
                        />
                        <Typography.Text>Step 1/2: Select new evaluator</Typography.Text>
                    </Space>

                    <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
                </div>
                <div>
                    <div className="flex items-center justify-between">
                        <Radio.Group
                            defaultValue={selectedEvaluatorCategory}
                            className={classes.radioBtnContainer}
                            onChange={(e) => setSelectedEvaluatorCategory(e.target.value)}
                        >
                            <Radio.Button value={"view_all"}>View all</Radio.Button>
                            <Divider type="vertical" className="h-7" />
                            {evaluatorTags.map((val, idx) => (
                                <Radio.Button key={idx} value={val.value}>
                                    {val.label}
                                </Radio.Button>
                            ))}
                        </Radio.Group>

                        <Flex gap={8}>
                            <Input.Search
                                style={{width: 400}}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search"
                                allowClear
                            />
                        </Flex>
                    </div>
                </div>
                <Divider className="mt-0 mb-4" />
            </div>

            <div>
                <NewEvaluatorList
                    evaluators={filteredEvaluators}
                    setSelectedEvaluator={setSelectedEvaluator}
                    setCurrent={setCurrent}
                />
            </div>
        </div>
    )
}

export default NewEvaluator
