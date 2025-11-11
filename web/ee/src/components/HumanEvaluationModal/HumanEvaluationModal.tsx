// @ts-nocheck
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import VariantDetailsWithStatus from "@agenta/oss/src/components/VariantDetailsWithStatus"
import {CaretDown, Play} from "@phosphor-icons/react"
import {Button, Col, Dropdown, MenuProps, Modal, Row, Select, Spin, message} from "antd"
import {getDefaultStore} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"
import isEqual from "lodash/isEqual"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import EvaluationErrorModal from "@/oss/components/Evaluations/EvaluationErrorModal"
import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import useURL from "@/oss/hooks/useURL"
import {PERMISSION_ERR_MSG} from "@/oss/lib/api/assets/axiosConfig"
import {EvaluationType} from "@/oss/lib/enums"
import {getErrorMessage} from "@/oss/lib/helpers/errorHandler"
import {isDemo} from "@/oss/lib/helpers/utils"
import {getAllVariantParameters, groupVariantsByParent} from "@/oss/lib/helpers/variantHelper"
import useStatelessVariants from "@/oss/lib/hooks/useStatelessVariants"
import type {GenericObject, Parameter, StyleProps, Variant} from "@/oss/lib/Types"
import {createNewEvaluation} from "@/oss/services/human-evaluations/api"
// import {currentAppAtom} from "@/oss/state/app"
import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {useAppsData} from "@/oss/state/app/hooks"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {useTestsetsData} from "@/oss/state/testset"

import {useStyles} from "./assets/styles"
import type {HumanEvaluationModalProps} from "./types"

const ShareEvaluationModal = dynamic(
    () => import("@/oss/components/Evaluations/ShareEvaluationModal"),
    {ssr: false},
)

const store = getDefaultStore()

const HumanEvaluationModal = ({
    isEvalModalOpen,
    setIsEvalModalOpen,
    evaluationType,
}: HumanEvaluationModalProps) => {
    const router = useRouter()
    const {appURL} = useURL()
    const {appTheme} = useAppTheme()
    const [isError, setIsError] = useState<boolean | string>(false)
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const {projectURL} = useURL()
    const [selectedTestset, setSelectedTestset] = useState<{
        _id?: string
        name: string
    }>({name: "Select a Test set"})
    const [testsetsList, setTestsetsList] = useState<any[]>([])

    const [selectedVariants, setSelectedVariants] = useState<Variant[]>(
        new Array(1).fill({variantName: "Select a variant"}),
    )

    const [_selectedCustomEvaluationID, _setSelectedCustomEvaluationID] = useState("")

    const appId = router.query.app_id?.toString() || ""
    const isAppScoped = Boolean(appId)
    const {apps: availableApps = []} = useAppsData()
    const routerAppId = useAtomValue(routerAppIdAtom)
    const setRouterAppId = useSetAtom(routerAppIdAtom)
    const originalRouterAppIdRef = useRef<string | null | undefined>(routerAppId)
    const [selectedAppId, setSelectedAppId] = useState<string>(appId)
    const appOptions = useMemo(() => {
        const options = availableApps.map((app) => ({
            label: app.app_name,
            value: app.app_id,
        }))
        if (selectedAppId && !options.some((opt) => opt.value === selectedAppId)) {
            options.push({label: selectedAppId, value: selectedAppId})
        }
        return options
    }, [availableApps, selectedAppId])

    const {testsets, isError: isTestsetsLoadingError} = useTestsetsData()
    const isAppSelectionComplete = Boolean(selectedAppId)

    const [variantsInputs, setVariantsInputs] = useState<Record<string, string[]>>({})

    const [error, setError] = useState({message: "", btnText: "", endpoint: ""})

    const [shareModalOpen, setShareModalOpen] = useState(false)

    const {
        variants: data,
        isLoading: areAppVariantsLoading,
        specMap,
        uriMap,
    } = useStatelessVariants()

    const filteredVariantData = useMemo(() => {
        if (!selectedAppId) return []
        return (data || []).filter((variant) => variant.appId === selectedAppId)
    }, [data, selectedAppId])

    const variants = useMemo(
        () => groupVariantsByParent(filteredVariantData || [], true),
        [filteredVariantData],
    )

    useEffect(() => {
        if (isEvalModalOpen) {
            originalRouterAppIdRef.current = routerAppId
        }
    }, [isEvalModalOpen, routerAppId])

    useEffect(() => {
        if (isAppScoped) {
            setSelectedAppId(appId)
            return
        }
        if (!isEvalModalOpen) {
            setSelectedAppId("")
        }
    }, [appId, isAppScoped, isEvalModalOpen])

    const handleAppSelection = useCallback(
        (value: string) => {
            setSelectedAppId(value)
            setSelectedVariants(new Array(1).fill({variantName: "Select a variant"}))
            setSelectedTestset({name: "Select a Test set"})
            if (!isAppScoped) {
                setRouterAppId(value || null)
            }
        },
        [isAppScoped, setRouterAppId, setSelectedVariants],
    )

    useEffect(() => {
        if (!isEvalModalOpen && !isAppScoped) {
            setRouterAppId(originalRouterAppIdRef.current ?? null)
        }
    }, [isEvalModalOpen, isAppScoped, setRouterAppId])

    useEffect(() => {
        if (!selectedAppId) return
        if (variants.length > 0) {
            const fetchAndSetSchema = async () => {
                try {
                    let results: {
                        variantName: string
                        inputs: string[]
                    }[]
                    // Prefer deriving inputs from OpenAPI schema exposed by useStatelessVariants
                    results = variants.map((_variant) => {
                        const variant = _variant.revisions.sort(
                            (a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp,
                        )[0]
                        const vId = variant.variantId || variant.id
                        const inputs = store.get(promptVariablesAtomFamily(vId))
                        return {
                            variantName: variant.variantName,
                            inputs,
                        }
                    })

                    // Fallback: if some variants have no inputs from schema, try server-side parameters API
                    if (results.some((r) => (r.inputs || []).length === 0)) {
                        const promises = variants.map((variant) =>
                            getAllVariantParameters(appId, variant).then((data) => ({
                                variantName: variant.variantName,
                                inputs:
                                    data?.inputs.map((inputParam: Parameter) => inputParam.name) ||
                                    [],
                            })),
                        )
                        const fallback = await Promise.all(promises)
                        // Merge fallback only where empty
                        const map = Object.fromEntries(
                            fallback.map((f) => [f.variantName, f.inputs]),
                        ) as Record<string, string[]>
                        results = results.map((r) => ({
                            variantName: r.variantName,
                            inputs:
                                r.inputs && r.inputs.length > 0
                                    ? r.inputs
                                    : map[r.variantName] || [],
                        }))
                    }

                    // Reduce the results into the desired newVariantsInputs object structure
                    const newVariantsInputs: Record<string, string[]> = results.reduce(
                        (acc: GenericObject, result) => {
                            acc[result.variantName] = result.inputs
                            return acc
                        },
                        {},
                    )

                    setVariantsInputs(newVariantsInputs)
                } catch (e: any) {
                    setIsError("Failed to fetch some variants parameters. Error: " + e?.message)
                }
            }

            fetchAndSetSchema()
        }
    }, [appId, selectedAppId, variants])

    useEffect(() => {
        if (!isAppSelectionComplete) {
            setTestsetsList([])
            return
        }
        if (!isTestsetsLoadingError && testsets) {
            setTestsetsList((prev) => {
                if (isEqual(prev, testsets)) {
                    return prev
                }

                return testsets
            })
        }
    }, [testsets, isTestsetsLoadingError, isAppSelectionComplete])

    const onTestsetSelect = (selectedTestsetIndexInTestsetsList: number) => {
        setSelectedTestset(testsetsList[selectedTestsetIndexInTestsetsList])
    }

    const getTestsetDropdownMenu = (): MenuProps => {
        if (!isAppSelectionComplete) return {items: []}

        const items: MenuProps["items"] = testsetsList.map((testset, index) => {
            return {
                label: (
                    <>
                        <div>{testset.name}</div>
                    </>
                ),
                key: `${testset.name}-${testset._id}`,
            }
        })

        const menuProps: MenuProps = {
            items,
            onClick: ({key}) => {
                const index = items.findIndex((item) => item?.key === key)
                onTestsetSelect(index)
            },
        }

        return menuProps
    }

    const handleAppVariantsMenuClick =
        (dropdownIndex: number) =>
        ({key}: {key: string}) => {
            const data = {
                variants: [
                    selectedVariants[dropdownIndex]?.variantName,
                    selectedVariants[dropdownIndex]?.variantName,
                ],
            }

            data.variants[dropdownIndex] = key
            const _selectedVariant = variants.find((variant) => variant.variantName === key)
            const selectedVariant = (_selectedVariant?.revisions || []).sort(
                (a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp,
            )[0]
            if (!selectedVariant) {
                console.error("Error: No variant found")
            }

            setSelectedVariants((prevState) => {
                const newState = [...prevState]
                newState[dropdownIndex] = selectedVariant
                return newState
            })
        }

    const getVariantsDropdownMenu = (index: number): MenuProps => {
        const selectedVariantsNames = selectedVariants.map(
            (revision) => revision.__parentVariant?.variantName,
        )

        const items = variants.reduce((filteredVariants, variant, idx) => {
            const label = variant.variantName

            if (!selectedVariantsNames.includes(label)) {
                filteredVariants.push({
                    label: (
                        <>
                            <div className="flex items-center justify-between">
                                <VariantDetailsWithStatus
                                    variantName={variant.variantName || variant.name}
                                    revision={variant.revision}
                                    variant={variant}
                                />
                                <span className={classes.dropdownItemLabels}>
                                    #
                                    {
                                        (
                                            variant.variantId ||
                                            variant.id ||
                                            variant.variant_id
                                        ).split("-")[0]
                                    }
                                </span>
                            </div>
                        </>
                    ),
                    key: label,
                })
            }

            return filteredVariants
        }, [])

        const menuProps: MenuProps = {
            items,
            onClick: handleAppVariantsMenuClick(index),
        }

        return menuProps
    }

    const onStartEvaluation = async () => {
        const targetAppId = selectedAppId || appId
        if (!targetAppId) {
            message.error("Please select an application")
            return
        }

        const selectedVariant = selectedVariants[0]
        // 1. We check all data is provided
        if (selectedTestset === undefined || selectedTestset.name === "Select a Test set") {
            message.error("Please select a Testset")
            return
        } else if (selectedVariant?.variantName === "Select a variant") {
            message.error("Please select a variant")
            return
        } else if (
            evaluationType === EvaluationType.human_a_b_testing &&
            selectedVariants[1]?.variantName === "Select a variant"
        ) {
            message.error("Please select a second variant")
            return
        }

        const inputs = store.get(
            promptVariablesAtomFamily(selectedVariant.variantId || selectedVariant.id),
        )

        // 2. We create a new app evaluation
        const evaluationTableId = await createNewEvaluation({
            variant_ids: selectedVariants.map((variant) => variant.variantId || variant.id),
            inputs,
            evaluationType: EvaluationType[evaluationType as keyof typeof EvaluationType],
            evaluationTypeSettings: {},
            llmAppPromptTemplate: "",
            selectedCustomEvaluationID: _selectedCustomEvaluationID,
            testsetId: selectedTestset._id!,
        }).catch((err) => {
            if (err.message !== PERMISSION_ERR_MSG) {
                setError({
                    message: getErrorMessage(err),
                    btnText: "Go to Test sets",
                    endpoint: `${projectURL}/testsets`,
                })
            }
        })

        if (!evaluationTableId) {
            return
        }

        // 3 We set the variants
        // setVariants(selectedVariants)

        const targetAppURL = targetAppId
            ? `${baseAppURL}/${encodeURIComponent(targetAppId)}`
            : appURL

        if (evaluationType === EvaluationType.human_a_b_testing) {
            router.push(`${targetAppURL}/evaluations/human_a_b_testing/${evaluationTableId}`)
        } else if (evaluationType === EvaluationType.single_model_test) {
            router.push(`${targetAppURL}/evaluations/single_model_test/${evaluationTableId}`)
        }
    }

    return (
        <>
            <Modal
                open={isEvalModalOpen}
                onCancel={() => {
                    setIsEvalModalOpen(false)

                    setSelectedTestset({name: "Select a Test set"})
                    setSelectedVariants(new Array(1).fill({variantName: "Select a variant"}))
                }}
                title="New Evaluation"
                footer={null}
            >
                <Spin spinning={areAppVariantsLoading && (selectedAppId || isAppScoped)}>
                    {typeof isError === "string" ? (
                        <div style={{margin: "20px 0"}}>{isError}</div>
                    ) : (
                        <div style={{display: "flex", flexDirection: "column", gap: 10}}>
                            <div>
                                <p>Which application do you want to evaluate?</p>
                                <Select
                                    style={{width: "100%"}}
                                    placeholder="Select an application"
                                    value={selectedAppId || undefined}
                                    onChange={handleAppSelection}
                                    disabled={isAppScoped}
                                    options={appOptions}
                                />
                            </div>

                            <div>
                                <p>Which testset you want to use?</p>
                                <Dropdown
                                    menu={getTestsetDropdownMenu()}
                                    disabled={!isAppSelectionComplete}
                                >
                                    <Button
                                        className={classes.dropdownBtn}
                                        disabled={!isAppSelectionComplete}
                                    >
                                        <div className={classes.dropdownStyles}>
                                            {selectedTestset.name}
                                            <CaretDown size={16} />
                                        </div>
                                    </Button>
                                </Dropdown>
                            </div>

                            <div>
                                <p>Which variants would you like to evaluate</p>
                                {Array.from({
                                    length: evaluationType === "human_a_b_testing" ? 2 : 1,
                                }).map((_, index) => (
                                    <Dropdown
                                        key={index}
                                        menu={getVariantsDropdownMenu(index)}
                                        disabled={!isAppSelectionComplete || !variants.length}
                                    >
                                        <Button
                                            className={classes.variantDropdown}
                                            style={{marginTop: index === 1 ? 8 : 0}}
                                            disabled={!isAppSelectionComplete || !variants.length}
                                        >
                                            <div className={classes.dropdownStyles}>
                                                {selectedVariants[index]?.variantName ||
                                                    "Select a variant"}
                                                <CaretDown size={16} />
                                            </div>
                                        </Button>
                                    </Dropdown>
                                ))}
                            </div>

                            <Row justify="end" gutter={8} style={{marginTop: "1.5rem"}}>
                                <Button
                                    style={{marginRight: "auto"}}
                                    key="cancel"
                                    onClick={() => setIsEvalModalOpen(false)}
                                >
                                    Cancel
                                </Button>
                                {evaluationType === EvaluationType.human_a_b_testing &&
                                    isDemo() && (
                                        <Col>
                                            <Button
                                                disabled={
                                                    !(
                                                        selectedVariants[0].variantId &&
                                                        selectedVariants[0].variantId &&
                                                        selectedTestset._id
                                                    )
                                                }
                                                onClick={() => setShareModalOpen(true)}
                                            >
                                                Invite Collaborators
                                            </Button>
                                        </Col>
                                    )}
                                <Col>
                                    <Button
                                        onClick={onStartEvaluation}
                                        type="primary"
                                        icon={<Play size={14} />}
                                        className="flex items-center"
                                    >
                                        Start
                                    </Button>
                                </Col>
                            </Row>
                        </div>
                    )}
                </Spin>
            </Modal>

            <EvaluationErrorModal
                isModalOpen={!!error.message}
                onClose={() => setError({message: "", btnText: "", endpoint: ""})}
                handleNavigate={() => router.push(error.endpoint)}
                message={error.message}
                btnText={error.btnText}
            />

            <ShareEvaluationModal
                open={shareModalOpen}
                onCancel={() => setShareModalOpen(false)}
                destroyOnHidden
                variantIds={selectedVariants.map((v) => v.variantId)}
                testsetId={selectedTestset._id}
                evaluationType={EvaluationType.human_a_b_testing}
            />
        </>
    )
}

export default HumanEvaluationModal
