import {type FC, memo, useCallback, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {createEvaluatorFromTemplate} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {CloseCircleOutlined} from "@ant-design/icons"
import {Input, Tabs, Tag, Typography} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {openHumanEvaluatorDrawerAtom} from "@/oss/components/Evaluators/Drawers/HumanEvaluatorDrawer/store"
import useFocusInput from "@/oss/hooks/useFocusInput"
import type {Evaluator} from "@/oss/lib/Types"
import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"

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

const NewEvaluationModalContent: FC<NewEvaluationModalContentProps> = ({
    onSuccess,
    handlePanelChange,
    activePanel,
    selectedTestsetId,
    selectedTestsetRevisionId,
    selectedTestsetName,
    selectedTestsetVersion,
    setSelectedTestsetId,
    setSelectedTestsetRevisionId,
    setSelectedTestsetName,
    setSelectedTestsetVersion,
    selectedVariantRevisionIds,
    setSelectedVariantRevisionIds,
    selectedEvalConfigs,
    setSelectedEvalConfigs,
    evaluationName,
    setEvaluationName,
    preview,
    evaluationType,
    testsets,
    evaluators,
    evaluatorConfigs,
    advanceSettings,
    setAdvanceSettings,
    appOptions,
    selectedAppId,
    onSelectApp,
    appSelectionDisabled,
    allowTestsetAutoAdvance,
    onSelectTemplate,
    onEvaluatorCreated,
    ...props
}) => {
    const classes = useStyles()
    const {inputRef} = useFocusInput({isOpen: props.isOpen || false})
    const appSelectionComplete = Boolean(selectedAppId)

    const openEvaluatorDrawer = useSetAtom(openEvaluatorDrawerAtom)
    const openHumanDrawer = useSetAtom(openHumanEvaluatorDrawerAtom)

    // Handler for opening the human evaluator creation drawer (preview mode)
    const handleCreateHumanEvaluator = useCallback(() => {
        openHumanDrawer({mode: "create", onSuccess: onEvaluatorCreated})
    }, [openHumanDrawer, onEvaluatorCreated])

    // Handler for opening the evaluator creation drawer with embedded playground
    const handleSelectTemplate = useCallback(
        async (evaluator: Evaluator) => {
            const templateKey = evaluator.key
            if (!templateKey) {
                message.error("Unable to open evaluator template")
                return
            }

            const localId = await createEvaluatorFromTemplate(templateKey)
            if (!localId) {
                message.error("Unable to create evaluator from template")
                return
            }

            openEvaluatorDrawer({
                entityId: localId,
                mode: "create",
                onEvaluatorCreated,
            })
            onSelectTemplate?.(evaluator)
        },
        [openEvaluatorDrawer, onSelectTemplate, onEvaluatorCreated],
    )

    const selectedVariants = useMemo(
        () => selectedVariantRevisionIds.map((id) => workflowMolecule.get.data(id)).filter(Boolean),
        [selectedVariantRevisionIds],
    )

    const selectedEvalConfig = useMemo(
        () => selectedEvalConfigs.map((id) => workflowMolecule.get.data(id)).filter(Boolean),
        [selectedEvalConfigs],
    )

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
                        <SelectAppSection
                            selectedAppId={selectedAppId}
                            onSelectApp={onSelectApp}
                            disabled={appSelectionDisabled}
                        />
                        {!appSelectionComplete && !appSelectionDisabled ? (
                            <Typography.Text type="secondary">
                                Please select an application to continue configuring the evaluation.
                            </Typography.Text>
                        ) : null}
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
                                {`${v.name || "-"} - v${v.version ?? 0}`}
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
                        className="pt-2"
                    />
                ) : (
                    requireAppMessage
                ),
            },
            {
                key: "testsetPanel",
                label: (
                    <TabLabel tabTitle="Test set" completed={Boolean(selectedTestsetName)}>
                        {selectedTestsetName ? (
                            <Tag
                                closeIcon={<CloseCircleOutlined />}
                                onClose={() => {
                                    setSelectedTestsetId("")
                                    setSelectedTestsetRevisionId("")
                                    setSelectedTestsetName("")
                                    setSelectedTestsetVersion(null)
                                }}
                            >
                                <span>{selectedTestsetName} -</span>
                                {typeof selectedTestsetVersion === "number" && (
                                    <span className="ml-1 text-xs text-gray-500">
                                        v{selectedTestsetVersion}
                                    </span>
                                )}
                            </Tag>
                        ) : null}
                    </TabLabel>
                ),
                children: appSelectionComplete ? (
                    <SelectTestsetSection
                        handlePanelChange={handlePanelChange}
                        selectedTestsetId={selectedTestsetId}
                        selectedTestsetRevisionId={selectedTestsetRevisionId}
                        selectedTestsetName={selectedTestsetName}
                        selectedTestsetVersion={selectedTestsetVersion}
                        setSelectedTestsetId={setSelectedTestsetId}
                        setSelectedTestsetRevisionId={setSelectedTestsetRevisionId}
                        setSelectedTestsetName={setSelectedTestsetName}
                        setSelectedTestsetVersion={setSelectedTestsetVersion}
                        testsets={testsets}
                        selectedVariantRevisionIds={selectedVariantRevisionIds}
                        selectedVariants={selectedVariants}
                        className="pt-2"
                        allowAutoAdvance={allowTestsetAutoAdvance}
                    />
                ) : (
                    requireAppMessage
                ),
            },
            {
                key: "evaluatorPanel",
                label: (
                    <TabLabel tabTitle="Evaluators" completed={selectedEvalConfig.length > 0}>
                        {selectedEvalConfig.map((cfg) => {
                            return (
                                <Tag
                                    key={cfg.id}
                                    closeIcon={<CloseCircleOutlined />}
                                    onClose={() => {
                                        setSelectedEvalConfigs(
                                            selectedEvalConfigs.filter((id) => id !== cfg.id),
                                        )
                                    }}
                                >
                                    {`${cfg.name || "-"} - v${cfg.version ?? 0}`}
                                </Tag>
                            )
                        })}
                    </TabLabel>
                ),
                children: appSelectionComplete ? (
                    <SelectEvaluatorSection
                        selectedEvalConfigs={selectedEvalConfigs}
                        setSelectedEvalConfigs={setSelectedEvalConfigs}
                        preview={preview}
                        selectedAppId={selectedAppId}
                        onSelectTemplate={handleSelectTemplate}
                        onCreateHumanEvaluator={handleCreateHumanEvaluator}
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
        selectedTestsetName,
        selectedVariants,
        selectedEvalConfig,
        handlePanelChange,
        selectedTestsetId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        preview,
        evaluationType,
        testsets,
        evaluators,
        evaluatorConfigs,
        advanceSettings,
        appSelectionComplete,
        appOptions,
        selectedAppId,
        onSelectApp,
        appSelectionDisabled,
        handleSelectTemplate,
        handleCreateHumanEvaluator,
        allowTestsetAutoAdvance,
    ])

    return (
        <div className="flex flex-col w-full gap-4 h-full max-h-full overflow-hidden [&_.ant-tabs]:!flex [&_.ant-tabs]:!w-full [&_.ant-tabs]:!grow [&_.ant-tabs]:!min-h-0">
            <div className="flex flex-col gap-2">
                <Typography.Text className="font-medium">Evaluation name</Typography.Text>
                <Input
                    ref={inputRef}
                    placeholder="Enter a name"
                    value={evaluationName}
                    onChange={(e) => {
                        setEvaluationName(e.target.value)
                    }}
                    data-tour="evaluation-name-input"
                />
            </div>

            <Tabs
                activeKey={activePanel || "appPanel"}
                onChange={handlePanelChange as any}
                items={items}
                tabPlacement="left"
                className={clsx([
                    classes.tabsContainer,
                    "[&_.ant-tabs-tab]:!p-2 [&_.ant-tabs-tab]:!mt-1",
                    "[&_.ant-tabs-nav]:!w-[240px]",
                    "[&_.ant-tabs-content]:!h-full [&_.ant-tabs-content]:!w-full",
                    "[&_.ant-tabs-tabpane]:!h-full [&_.ant-tabs-tabpane]:!max-h-full [&_.ant-tabs-tabpane]:!w-full",
                ])}
            />
        </div>
    )
}

export default memo(NewEvaluationModalContent)
