// @ts-nocheck
import {type FC, memo, useMemo} from "react"

import {CloseCircleOutlined} from "@ant-design/icons"
import {Input, Typography, Tabs, Tag, Space} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import useFocusInput from "@/oss/hooks/useFocusInput"

import {useStyles} from "../assets/styles"
import TabLabel from "../assets/TabLabel"
import {NewEvaluationModalContentProps} from "../types"

const SelectEvaluatorSection = dynamic(
    () => import("./SelectEvaluatorSection/SelectEvaluatorSection"),
    {
        ssr: false,
    },
)

const SelectTestsetSection = dynamic(() => import("./SelectTestsetSection"), {
    ssr: false,
})

const SelectVariantSection = dynamic(() => import("./SelectVariantSection"), {
    ssr: false,
})

const NewEvaluationModalContent: FC<NewEvaluationModalContentProps> = ({
    onSuccess,
    handlePanelChange,
    activePanel,
    selectedTestsetId,
    setSelectedTestsetId,
    selectedVariantRevisionIds,
    setSelectedVariantRevisionIds,
    selectedEvalConfigs,
    setSelectedEvalConfigs,
    evaluationName,
    setEvaluationName,
    preview,
    evaluationType,
    testSets,
    variants,
    evaluators,
    evaluatorConfigs,
    ...props
}) => {
    const classes = useStyles()
    const {inputRef} = useFocusInput({isOpen: props.isOpen || false})

    const selectedTestset = useMemo(
        () => testSets.find((ts) => ts._id === selectedTestsetId) || null,
        [testSets, selectedTestsetId],
    )

    const selectedVariants = useMemo(
        () => variants?.filter((v) => selectedVariantRevisionIds.includes(v.id)) || [],
        [variants, selectedVariantRevisionIds],
    )

    const selectedEvalConfig = useMemo(() => {
        const source = preview ? (evaluators as any[]) : (evaluatorConfigs as any[])
        return source.filter((cfg) => selectedEvalConfigs.includes(cfg.id))
    }, [preview, evaluators, evaluatorConfigs, selectedEvalConfigs])

    const items = useMemo(() => {
        return [
            {
                key: "testsetPanel",
                label: (
                    <TabLabel tabTitle="Testset" completed={selectedTestset !== null}>
                        {selectedTestset ? (
                            <Tag
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    setSelectedTestsetId(null)
                                }}
                            >
                                {selectedTestset.name}
                            </Tag>
                        ) : null}
                    </TabLabel>
                ),
                children: (
                    <SelectTestsetSection
                        handlePanelChange={handlePanelChange}
                        selectedTestsetId={selectedTestsetId}
                        setSelectedTestsetId={setSelectedTestsetId}
                        testSets={testSets}
                        className="pt-2"
                    />
                ),
            },
            {
                key: "variantPanel",
                label: (
                    <TabLabel tabTitle={"Variant"} completed={selectedVariants.length > 0}>
                        {selectedVariants.map((v) => (
                            <Tag
                                key={v.id}
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    setSelectedVariantRevisionIds(
                                        selectedVariantRevisionIds.filter((id) => id !== v.id),
                                    )
                                }}
                            >
                                {`${v.variantName} - v${v.revision}`}
                            </Tag>
                        ))}
                    </TabLabel>
                ),
                children: (
                    <SelectVariantSection
                        handlePanelChange={handlePanelChange}
                        selectedVariantRevisionIds={selectedVariantRevisionIds}
                        setSelectedVariantRevisionIds={setSelectedVariantRevisionIds}
                        evaluationType={evaluationType}
                        variants={variants}
                        className="pt-2"
                    />
                ),
            },
            {
                key: "evaluatorPanel",
                label: (
                    <TabLabel tabTitle="Evaluator" completed={selectedEvalConfig.length > 0}>
                        {selectedEvalConfig.map((cfg: any) => {
                            return (
                                <Tag
                                    key={cfg.id}
                                    closeIcon={<CloseCircleOutlined />}
                                    color={cfg.color}
                                    onClose={() => {
                                        setSelectedEvalConfigs(
                                            selectedEvalConfigs.filter((id) => id !== cfg.id),
                                        )
                                    }}
                                >
                                    {cfg.name}
                                </Tag>
                            )
                        })}
                    </TabLabel>
                ),
                children: (
                    <SelectEvaluatorSection
                        handlePanelChange={handlePanelChange}
                        selectedEvalConfigs={selectedEvalConfigs}
                        setSelectedEvalConfigs={setSelectedEvalConfigs}
                        preview={preview}
                        evaluators={evaluators as any}
                        evaluatorConfigs={evaluatorConfigs}
                        className="pt-2"
                    />
                ),
            },
        ]
    }, [
        selectedTestset,
        selectedVariants,
        selectedEvalConfig,
        handlePanelChange,
        selectedTestsetId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        preview,
        evaluationType,
        testSets,
        variants,
        evaluators,
        evaluatorConfigs,
    ])

    return (
        <div className="flex flex-col w-full gap-4 h-full overflow-hidden">
            {evaluationType === "human" ? (
                <div className="flex flex-col gap-2">
                    <Typography.Text className="font-medium">Evaluation name</Typography.Text>
                    <Input
                        ref={inputRef}
                        placeholder="Enter a name"
                        value={evaluationName}
                        onChange={(e) => {
                            setEvaluationName(e.target.value)
                        }}
                    />
                </div>
            ) : null}

            <Tabs
                activeKey={activePanel || "testsetPanel"}
                onChange={handlePanelChange as any}
                items={items}
                tabPosition="left"
                className={clsx([
                    classes.tabsContainer,
                    "[&_.ant-tabs-tab]:!p-2 [&_.ant-tabs-tab]:!mt-1",
                    "[&_.ant-tabs-nav]:!w-[240px]",
                ])}
            />
        </div>
    )
}

export default memo(NewEvaluationModalContent)
