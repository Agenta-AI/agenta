import {type FC, memo, useCallback, useMemo} from "react"

import {CloseCircleOutlined} from "@ant-design/icons"
import {Input, Typography, Tabs, Tag} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import useFocusInput from "@/oss/hooks/useFocusInput"
import useURL from "@/oss/hooks/useURL"

import {useStyles} from "../assets/styles"
import TabLabel from "../assets/TabLabel"
import {NewEvaluationModalContentProps} from "../types"

const SelectAppSection = dynamic(() => import("./SelectAppSection"), {ssr: false})

const SelectEvaluatorSection = dynamic(
    () => import("./SelectEvaluatorSection/SelectEvaluatorSection"),
    {ssr: false},
)

const SelectTestsetSection = dynamic(() => import("./SelectTestsetSection"), {
    ssr: false,
})

const SelectVariantSection = dynamic(() => import("./SelectVariantSection"), {
    ssr: false,
})

const AdvancedSettings = dynamic(() => import("./AdvancedSettings"), {
    ssr: false,
})

const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
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
    testsets,
    variants,
    variantsLoading,
    evaluators,
    evaluatorConfigs,
    advanceSettings,
    setAdvanceSettings,
    appOptions,
    selectedAppId,
    onSelectApp,
    appSelectionDisabled,
    ...props
}) => {
    const classes = useStyles()
    const {inputRef} = useFocusInput({isOpen: props.isOpen || false})
    const {redirectUrl} = useURL()
    const appSelectionComplete = Boolean(selectedAppId)
    const hasAppOptions = appOptions.length > 0

    const handleCreateApp = useCallback(() => {
        redirectUrl()
    }, [redirectUrl])

    const selectedTestset = useMemo(
        () => testsets.find((ts) => ts._id === selectedTestsetId) || null,
        [testsets, selectedTestsetId],
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
        const requireAppMessage = (
            <Typography.Text type="secondary">
                Select an application first to load this section.
            </Typography.Text>
        )

        return [
            {
                key: "appPanel",
                label: (
                    <TabLabel tabTitle="Application" completed={appSelectionComplete}>
                        {appSelectionComplete && (
                            <Tag
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    if (!appSelectionDisabled) onSelectApp("")
                                }}
                            >
                                {appOptions.find((opt) => opt.value === selectedAppId)?.label ??
                                    selectedAppId}
                            </Tag>
                        )}
                    </TabLabel>
                ),
                children: (
                    <div className="flex flex-col gap-2">
                        {hasAppOptions ? (
                            <>
                                <SelectAppSection
                                    apps={appOptions}
                                    selectedAppId={selectedAppId}
                                    onSelectApp={onSelectApp}
                                    disabled={appSelectionDisabled}
                                />
                                {!appSelectionComplete && !appSelectionDisabled ? (
                                    <Typography.Text type="secondary">
                                        Please select an application to continue configuring the
                                        evaluation.
                                    </Typography.Text>
                                ) : null}
                            </>
                        ) : (
                            <NoResultsFound
                                title="No applications found"
                                description="You need at least one application to configure an evaluation. Head to App Management to create one."
                                primaryActionLabel="Create an app"
                                onPrimaryAction={handleCreateApp}
                            />
                        )}
                    </div>
                ),
            },
            {
                key: "variantPanel",
                label: (
                    <TabLabel tabTitle="Variant" completed={selectedVariants.length > 0}>
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
                children: appSelectionComplete ? (
                    <SelectVariantSection
                        handlePanelChange={handlePanelChange}
                        selectedVariantRevisionIds={selectedVariantRevisionIds}
                        setSelectedVariantRevisionIds={setSelectedVariantRevisionIds}
                        evaluationType={evaluationType}
                        variants={variants}
                        isVariantLoading={variantsLoading}
                        className="pt-2"
                        selectedTestsetId={selectedTestsetId}
                    />
                ) : (
                    requireAppMessage
                ),
            },
            {
                key: "testsetPanel",
                label: (
                    <TabLabel tabTitle="Testset" completed={selectedTestset !== null}>
                        {selectedTestset ? (
                            <Tag
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    setSelectedTestsetId("")
                                }}
                            >
                                {selectedTestset.name}
                            </Tag>
                        ) : null}
                    </TabLabel>
                ),
                children: appSelectionComplete ? (
                    <SelectTestsetSection
                        handlePanelChange={handlePanelChange}
                        selectedTestsetId={selectedTestsetId}
                        setSelectedTestsetId={setSelectedTestsetId}
                        testsets={testsets}
                        selectedVariantRevisionIds={selectedVariantRevisionIds}
                        selectedVariants={selectedVariants}
                        className="pt-2"
                    />
                ) : (
                    requireAppMessage
                ),
            },
            {
                key: "evaluatorPanel",
                label: (
                    <TabLabel tabTitle="Evaluators" completed={selectedEvalConfig.length > 0}>
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
                children: appSelectionComplete ? (
                    <SelectEvaluatorSection
                        handlePanelChange={handlePanelChange}
                        selectedEvalConfigs={selectedEvalConfigs}
                        setSelectedEvalConfigs={setSelectedEvalConfigs}
                        preview={preview}
                        evaluators={evaluators as any}
                        evaluatorConfigs={evaluatorConfigs}
                        selectedAppId={selectedAppId}
                        className="pt-2"
                    />
                ) : (
                    requireAppMessage
                ),
            },
            ...(evaluationType === "auto"
                ? [
                      {
                          key: "advancedSettingsPanel",
                          label: (
                              <TabLabel tabTitle="Advanced Settings" completed={true}>
                                  {Object.entries(advanceSettings).map(([key, value]) => (
                                      <Tag key={key} className="max-w-[200px] truncate">
                                          {key}: {value}
                                      </Tag>
                                  ))}
                              </TabLabel>
                          ),
                          children: appSelectionComplete ? (
                              <AdvancedSettings
                                  advanceSettings={advanceSettings}
                                  setAdvanceSettings={setAdvanceSettings}
                              />
                          ) : (
                              requireAppMessage
                          ),
                      },
                  ]
                : []),
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
        testsets,
        variants,
        evaluators,
        evaluatorConfigs,
        advanceSettings,
        appSelectionComplete,
        appOptions,
        selectedAppId,
        onSelectApp,
        appSelectionDisabled,
        hasAppOptions,
        handleCreateApp,
    ])

    return (
        <div className="flex flex-col w-full gap-4 h-full overflow-hidden">
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

            <Tabs
                activeKey={activePanel || "appPanel"}
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
