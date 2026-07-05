import {type FC, memo, useCallback, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {createEvaluatorFromTemplate} from "@agenta/entities/workflow"
import {Input} from "@agenta/primitive-ui/components/input"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"
import {message} from "@agenta/ui/app-message"
import {CloseCircleOutlined} from "@ant-design/icons"
import {Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {openHumanEvaluatorDrawerAtom} from "@/oss/components/Evaluators/Drawers/HumanEvaluatorDrawer/store"
import useFocusInput from "@/oss/hooks/useFocusInput"
import type {Evaluator} from "@/oss/lib/Types"
import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"

import TabLabel from "../assets/TabLabel"
import {NewEvaluationModalContentProps} from "../types"

const SelectWorkflowSection = dynamic(() => import("./SelectWorkflowSection"), {ssr: false})

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

interface SelectedRevisionLike {
    id?: string | null
    name?: string | null
    version?: number | null
}

/**
 * Variant tag label. The display name lives on the VARIANT (fall back to its
 * slug): SDK-created variants and revisions may carry no `name` at all, and
 * UI-created revisions are named after the variant.
 */
const RevisionTagLabel = memo(({revision}: {revision: SelectedRevisionLike}) => {
    const variantLabel = useAtomValue(workflowMolecule.selectors.variantLabel(revision.id ?? ""))
    const label = variantLabel ?? revision.name ?? "-"
    return <>{`${label} - v${revision.version ?? 0}`}</>
})

/**
 * Evaluator tag label. The entity display name lives on the workflow artifact;
 * the revision's own `name` carries the variant name ("default").
 */
const EvaluatorTagLabel = memo(
    ({cfg}: {cfg: {id: string; name?: string | null; version?: number | null}}) => {
        const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(cfg.id))
        return <>{`${artifactName ?? cfg.name ?? "-"} - v${cfg.version ?? 0}`}</>
    },
)

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
    const {inputRef} = useFocusInput<HTMLInputElement>({isOpen: props.isOpen || false})
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
        () =>
            selectedVariantRevisionIds
                .map((id) => workflowMolecule.get.data(id))
                .filter((w): w is NonNullable<typeof w> => Boolean(w)),
        [selectedVariantRevisionIds],
    )

    const selectedEvalConfig = useMemo(
        () =>
            selectedEvalConfigs
                .map((id) => workflowMolecule.get.data(id))
                .filter((w): w is NonNullable<typeof w> => Boolean(w)),
        [selectedEvalConfigs],
    )

    const items = useMemo(() => {
        const requireAppMessage = (
            <span className="text-muted-foreground">
                Select an application first to load this section.
            </span>
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
                        <SelectWorkflowSection
                            selectedWorkflowId={selectedAppId}
                            onSelectWorkflow={onSelectApp}
                            disabled={appSelectionDisabled}
                        />
                        {!appSelectionComplete && !appSelectionDisabled ? (
                            <span className="text-muted-foreground">
                                Please select an application to continue configuring the evaluation.
                            </span>
                        ) : null}
                    </div>
                ),
            },
            {
                key: "variantPanel",
                label: (
                    <TabLabel tabTitle="Revision" completed={selectedVariants.length > 0}>
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
                                <RevisionTagLabel revision={v} />
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
                                    <EvaluatorTagLabel cfg={cfg} />
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
        <div className="flex flex-col w-full gap-4 h-full max-h-full overflow-hidden">
            <div className="flex flex-col gap-2">
                <span className="font-medium">Evaluation name</span>
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
                value={activePanel || "appPanel"}
                onValueChange={(value) => handlePanelChange(String(value))}
                orientation="vertical"
                className="w-full grow min-h-0 gap-4 overflow-hidden"
            >
                <TabsList
                    variant="line"
                    className="w-[240px] shrink-0 items-stretch justify-start overflow-y-auto p-0"
                >
                    {items.map((item) => (
                        <TabsTrigger
                            key={item.key}
                            value={item.key}
                            className="mt-1 h-auto min-h-0 w-full shrink-0 justify-start rounded-none p-2 text-colorTextSecondary hover:bg-colorInfoBg data-active:bg-controlItemBgActive data-active:text-colorPrimary data-active:font-medium after:!end-0 after:!bg-[var(--ag-colorPrimary)]"
                        >
                            {item.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <div className="min-w-0 flex-1 overflow-auto pl-4">
                    {items.map((item) => (
                        <TabsContent
                            key={item.key}
                            value={item.key}
                            keepMounted
                            className="h-full max-h-full w-full"
                        >
                            {item.children}
                        </TabsContent>
                    ))}
                </div>
            </Tabs>
        </div>
    )
}

export default memo(NewEvaluationModalContent)
