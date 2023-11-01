import {useState, useEffect} from "react"
import {
    Button,
    Col,
    Dropdown,
    MenuProps,
    Radio,
    RadioChangeEvent,
    Row,
    Typography,
    Select,
    message,
    ModalProps,
    Tooltip,
} from "antd"
import {DownOutlined, PlusOutlined, EditFilled} from "@ant-design/icons"
import {
    createNewEvaluation,
    fetchVariants,
    useLoadTestsetsList,
    fetchCustomEvaluations,
} from "@/lib/services/api"
import {dynamicComponent, getOpenAIKey, isDemo} from "@/lib/helpers/utils"
import {useRouter} from "next/router"
import {Variant, Parameter, GenericObject, SingleCustomEvaluation} from "@/lib/Types"
import {EvaluationType} from "@/lib/enums"
import {EvaluationTypeLabels} from "@/lib/helpers/utils"
import EvaluationErrorModal from "./EvaluationErrorModal"
import {getAllVariantParameters} from "@/lib/helpers/variantHelper"

import Image from "next/image"
import abTesting from "@/media/testing.png"
import exactMatch from "@/media/target.png"
import similarity from "@/media/transparency.png"
import regexIcon from "@/media/programming.png"
import webhookIcon from "@/media/link.png"
import ai from "@/media/artificial-intelligence.png"
import codeIcon from "@/media/browser.png"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"
import AutomaticEvaluationResult from "./AutomaticEvaluationResult"
import HumanEvaluationResult from "./HumanEvaluationResult"
import {getErrorMessage} from "@/lib/helpers/errorHandler"

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    evaluationContainer: {
        border: "1px solid lightgrey",
        padding: "20px",
        borderRadius: "14px",
        marginBottom: 50,
    },
    evaluationImg: ({themeMode}: StyleProps) => ({
        width: 24,
        height: 24,
        marginRight: "8px",
        filter: themeMode === "dark" ? "invert(1)" : "none",
    }),
    createCustomEvalBtn: {
        color: "#fff  !important",
        backgroundColor: "#0fbf0f",
        marginRight: "20px",
        borderColor: "#0fbf0f !important",
    },
    evaluationType: {
        display: "flex",
        alignItems: "center",
    },
    dropdownStyles: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
    },
    dropdownBtn: {
        marginRight: 10,
        marginTop: 40,
        width: "100%",
    },
    optionSelected: {
        border: "1px solid #1668dc",
        "& .ant-select-selection-item": {
            color: "#1668dc !important",
        },
    },
    radioGroup: {
        width: "100%",
    },
    radioBtn: {
        display: "block",
        marginBottom: "10px",
    },
    selectGroup: {
        width: "100%",
        display: "block",
        "& .ant-select-selector": {
            borderRadius: 0,
        },
        "& .ant-select-selection-item": {
            marginLeft: 34,
        },
    },
    customCodeSelectContainer: {
        position: "relative",
    },
    customCodeIcon: {
        position: "absolute",
        left: 16,
        top: 4.5,
        pointerEvents: "none",
    },
    thresholdStyles: {
        paddingLeft: 10,
        paddingRight: 10,
    },
    variantDropdown: {
        marginRight: 10,
        width: "100%",
    },
    newCodeEval: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#1668dc",
    },
    newCodeEvalList: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
})
const {Title} = Typography

export default function Evaluations() {
    const router = useRouter()
    const {appTheme} = useAppTheme()
    const [areAppVariantsLoading, setAppVariantsLoading] = useState(false)
    const [isError, setIsError] = useState<boolean | string>(false)
    const [variants, setVariants] = useState<any[]>([])
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const {Option} = Select

    const [selectedTestset, setSelectedTestset] = useState<{
        _id?: string
        name: string
    }>({name: "Select a Test set"})
    const [testsetsList, setTestsetsList] = useState<any[]>([])

    const [selectedVariants, setSelectedVariants] = useState<Variant[]>(
        new Array(1).fill({variantName: "Select a variant"}),
    )
    const [numberOfVariants, setNumberOfVariants] = useState<number>(1)

    const [selectedEvaluationType, setSelectedEvaluationType] = useState<EvaluationType | string>(
        "Select an evaluation type",
    )
    const [selectedCustomEvaluationID, setSelectedCustomEvaluationID] = useState("")

    const appId = router.query.app_id?.toString() || ""

    const {testsets, isTestsetsLoadingError} = useLoadTestsetsList(appId)

    const [variantsInputs, setVariantsInputs] = useState<Record<string, string[]>>({})

    const [error, setError] = useState({message: "", btnText: "", endpoint: ""})

    const [llmAppPromptTemplate, setLLMAppPromptTemplate] = useState("")

    const [customCodeEvaluationList, setCustomCodeEvaluationList] =
        useState<SingleCustomEvaluation[]>()

    const [shareModalOpen, setShareModalOpen] = useState(false)

    const ShareEvaluationModal = dynamicComponent<ModalProps & GenericObject>(
        "Evaluations/ShareEvaluationModal",
    )

    useEffect(() => {
        const fetchData = async () => {
            try {
                const backendVariants = await fetchVariants(appId)

                if (backendVariants.length > 0) {
                    setVariants(backendVariants)
                }

                setAppVariantsLoading(false)
            } catch (error) {
                setIsError("Failed to fetch variants")
                setAppVariantsLoading(false)
            }
        }

        fetchData()
    }, [appId])

    useEffect(() => {
        if (variants.length > 0) {
            const fetchAndSetSchema = async () => {
                try {
                    // Map the variants to an array of promises
                    const promises = variants.map((variant) =>
                        getAllVariantParameters(appId, variant).then((data) => ({
                            variantName: variant.variantName,
                            inputs:
                                data?.inputs.map((inputParam: Parameter) => inputParam.name) || [],
                        })),
                    )

                    // Wait for all promises to complete and collect results
                    const results = await Promise.all(promises)

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
    }, [appId, variants])

    useEffect(() => {
        if (!isTestsetsLoadingError && testsets) {
            setTestsetsList(testsets)
        }
    }, [testsets, isTestsetsLoadingError])

    const onTestsetSelect = (selectedTestsetIndexInTestsetsList: number) => {
        setSelectedTestset(testsetsList[selectedTestsetIndexInTestsetsList])
    }

    const getTestsetDropdownMenu = (): MenuProps => {
        const items: MenuProps["items"] = testsetsList.map((testset, index) => {
            return {
                label: (
                    <>
                        <div data-cy={`testset-${index}`}>{testset.name}</div>
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
                    selectedVariants[dropdownIndex].variantName,
                    selectedVariants[dropdownIndex].variantName,
                ],
            }

            data.variants[dropdownIndex] = key
            const selectedVariant = variants.find((variant) => variant.variantName === key)

            if (!selectedVariant) {
                console.log("Error: No variant found")
            }

            setSelectedVariants((prevState) => {
                const newState = [...prevState]
                newState[dropdownIndex] = selectedVariant
                return newState
            })
        }

    const getVariantsDropdownMenu = (index: number): MenuProps => {
        const selectedVariantsNames = selectedVariants.map((variant) => variant.variantName)

        const items = variants.reduce((filteredVariants, variant, idx) => {
            const label = variant.variantName

            if (!selectedVariantsNames.includes(label)) {
                filteredVariants.push({
                    label: (
                        <>
                            <div data-cy={`variant-${idx}`}>{variant.variantName}</div>
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
        // 1. We check all data is provided
        if (selectedTestset === undefined || selectedTestset.name === "Select a testSet") {
            message.error("Please select a Testset")
            return
        } else if (selectedVariants[0].variantName === "Select a variant") {
            message.error("Please select a variant")
            return
        } else if (
            selectedEvaluationType === EvaluationType.human_a_b_testing &&
            selectedVariants[1]?.variantName === "Select a variant"
        ) {
            message.error("Please select a second variant")
            return
        } else if (selectedEvaluationType === "Select an evaluation type") {
            message.error("Please select an evaluation type")
            return
        } else if (selectedTestset?.name === "Select a Test set") {
            message.error("Please select a testset")
            return
        } else if (!getOpenAIKey() && selectedEvaluationType === EvaluationType.auto_ai_critique) {
            setError({
                message:
                    "In order to run an AI Critique evaluation, please set your OpenAI API key in the API Keys page.",
                btnText: "Go to API Keys",
                endpoint: "/settings/?tab=secrets",
            })
            return
        }

        // 2. We create a new app evaluation
        const evaluationTypeSettings: GenericObject = {}
        //set default settings upon creation
        if (selectedEvaluationType === EvaluationType.auto_similarity_match) {
            evaluationTypeSettings.similarity_threshold = 0.3
        } else if (selectedEvaluationType === EvaluationType.auto_regex_test) {
            evaluationTypeSettings.regex_pattern = ""
            evaluationTypeSettings.regex_should_match = true
        } else if (selectedEvaluationType === EvaluationType.auto_webhook_test) {
            evaluationTypeSettings.webhook_url = `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/webhook_example_fake`
        }

        const evaluationTableId = await createNewEvaluation({
            variant_ids: selectedVariants.map((variant) => variant.variantId),
            appId,
            inputs: variantsInputs[selectedVariants[0].variantName],
            evaluationType: EvaluationType[selectedEvaluationType as keyof typeof EvaluationType],
            evaluationTypeSettings,
            llmAppPromptTemplate,
            selectedCustomEvaluationID,
            testsetId: selectedTestset._id!,
        }).catch((err) => {
            setError({
                message: getErrorMessage(err),
                btnText: "Go to Test sets",
                endpoint: `/apps/${appId}/testsets`,
            })
        })

        if (!evaluationTableId) {
            return
        }

        // 3 We set the variants
        setVariants(selectedVariants)

        if (selectedEvaluationType === EvaluationType.auto_exact_match) {
            router.push(`/apps/${appId}/evaluations/${evaluationTableId}/auto_exact_match`)
        } else if (selectedEvaluationType === EvaluationType.human_a_b_testing) {
            router.push(`/apps/${appId}/evaluations/${evaluationTableId}/human_a_b_testing`)
        } else if (selectedEvaluationType === EvaluationType.auto_similarity_match) {
            router.push(`/apps/${appId}/evaluations/${evaluationTableId}/similarity_match`)
        } else if (selectedEvaluationType === EvaluationType.auto_regex_test) {
            router.push(`/apps/${appId}/evaluations/${evaluationTableId}/auto_regex_test`)
        } else if (selectedEvaluationType === EvaluationType.auto_webhook_test) {
            router.push(`/apps/${appId}/evaluations/${evaluationTableId}/auto_webhook_test`)
        } else if (selectedEvaluationType === EvaluationType.auto_ai_critique) {
            router.push(`/apps/${appId}/evaluations/${evaluationTableId}/auto_ai_critique`)
        } else if (selectedEvaluationType === EvaluationType.custom_code_run) {
            router.push(
                `/apps/${appId}/evaluations/${evaluationTableId}/custom_code_run?custom_eval_id=${selectedCustomEvaluationID}`,
            )
        }
    }

    const onChangeEvaluationType = (e: RadioChangeEvent) => {
        const evaluationType = e.target.value
        setSelectedEvaluationType(evaluationType)
        setSelectedCustomEvaluationID("")
        let nbOfVariants = 1
        if (evaluationType === EvaluationType.human_a_b_testing) {
            nbOfVariants = 2
        }
        setNumberOfVariants(nbOfVariants)

        // set the selected variants array length based on numVariants
        setSelectedVariants(
            Array.from(
                {length: nbOfVariants},
                (_, i) => selectedVariants[i] || {variantName: "Select a variant"},
            ),
        )
    }

    useEffect(() => {
        if (appId)
            fetchCustomEvaluations(appId).then((res) => {
                if (res.status === 200) {
                    setCustomCodeEvaluationList(res.data)
                }
            })
    }, [appId])

    const handleCustomEvaluationOptionChange = (id: string) => {
        if (id === "new") {
            router.push(`/apps/${appId}/evaluations/create_custom_evaluation`)
        }
        setSelectedCustomEvaluationID(id)
        setSelectedEvaluationType(EvaluationType.custom_code_run)
    }

    const handleEditOption = (id: string) => {
        router.push(`/apps/${appId}/evaluations/custom_evaluations/${id}`)
    }

    return (
        <div>
            <div>
                {typeof isError === "string" && <div>{isError}</div>}
                {areAppVariantsLoading && <div>loading variants...</div>}
            </div>
            <div className={classes.evaluationContainer} data-cy="evaluations-container">
                <Row justify="start" gutter={24}>
                    <Col span={8}>
                        <Title level={4}>1. Select an evaluation type</Title>
                        <Title level={5}>Human evaluation</Title>
                        <Radio.Group
                            onChange={(e) => onChangeEvaluationType(e)}
                            className={classes.radioGroup}
                            value={selectedEvaluationType}
                        >
                            <Radio.Button
                                value={EvaluationType.human_a_b_testing}
                                className={classes.radioBtn}
                            >
                                <div className={classes.evaluationType}>
                                    <Image
                                        src={abTesting}
                                        alt="Picture of the author"
                                        className={classes.evaluationImg}
                                    />
                                    <span>
                                        {EvaluationTypeLabels[EvaluationType.human_a_b_testing]}
                                    </span>
                                </div>
                            </Radio.Button>

                            <Title level={5}>Automatic evaluation</Title>

                            <Radio.Button
                                value={EvaluationType.auto_exact_match}
                                className={classes.radioBtn}
                            >
                                <div
                                    className={classes.evaluationType}
                                    data-cy="exact-match-button"
                                >
                                    <Image
                                        src={exactMatch}
                                        alt="Exact match"
                                        className={classes.evaluationImg}
                                    />

                                    <span>
                                        {EvaluationTypeLabels[EvaluationType.auto_exact_match]}
                                    </span>
                                </div>
                            </Radio.Button>
                            <Radio.Button
                                value={EvaluationType.auto_similarity_match}
                                className={classes.radioBtn}
                            >
                                <div className={classes.evaluationType}>
                                    <Image
                                        src={similarity}
                                        alt="Similarity"
                                        className={classes.evaluationImg}
                                    />

                                    <span>
                                        {EvaluationTypeLabels[EvaluationType.auto_similarity_match]}
                                    </span>
                                </div>
                            </Radio.Button>
                            <Radio.Button
                                value={EvaluationType.auto_regex_test}
                                className={classes.radioBtn}
                            >
                                <div className={classes.evaluationType} data-cy="regex-button">
                                    <Image
                                        src={regexIcon}
                                        alt="Regex"
                                        className={classes.evaluationImg}
                                    />

                                    <span>
                                        {EvaluationTypeLabels[EvaluationType.auto_regex_test]}
                                    </span>
                                </div>
                            </Radio.Button>
                            <Radio.Button
                                value={EvaluationType.auto_webhook_test}
                                className={classes.radioBtn}
                            >
                                <div className={classes.evaluationType}>
                                    <Image
                                        src={webhookIcon}
                                        alt="Webhook"
                                        className={classes.evaluationImg}
                                    />

                                    <span>
                                        {EvaluationTypeLabels[EvaluationType.auto_webhook_test]}
                                    </span>
                                </div>
                            </Radio.Button>
                            <Radio.Button
                                value={EvaluationType.auto_ai_critique}
                                className={classes.radioBtn}
                            >
                                <div className={classes.evaluationType} data-cy="ai-critic-button">
                                    <Image src={ai} alt="AI" className={classes.evaluationImg} />

                                    <span>
                                        {EvaluationTypeLabels[EvaluationType.auto_ai_critique]}
                                    </span>
                                </div>
                            </Radio.Button>

                            <div className={classes.customCodeSelectContainer}>
                                <Select
                                    data-cy="code-evaluation-button"
                                    className={`${classes.selectGroup} ${
                                        selectedCustomEvaluationID ? classes.optionSelected : ""
                                    }`}
                                    value={selectedCustomEvaluationID || "Code Evaluation"}
                                    onChange={handleCustomEvaluationOptionChange}
                                    optionLabelProp="label"
                                >
                                    <Option
                                        value="new"
                                        label="New code evaluation"
                                        data-cy="new-code-evaluation-button"
                                    >
                                        <div className={classes.newCodeEval}>
                                            <PlusOutlined />
                                            New code evaluation
                                        </div>
                                    </Option>
                                    {...(customCodeEvaluationList || []).map(
                                        (item: SingleCustomEvaluation) => (
                                            <Option
                                                key={item.id}
                                                value={item.id}
                                                label={item.evaluation_name}
                                                data-cy="code-evaluation-option"
                                            >
                                                <div className={classes.newCodeEvalList}>
                                                    <p>{item.evaluation_name}</p>
                                                    <Tooltip placement="right" title="Edit">
                                                        <Button
                                                            type="text"
                                                            onClick={() =>
                                                                handleEditOption(item.id)
                                                            }
                                                        >
                                                            <EditFilled />
                                                        </Button>
                                                    </Tooltip>
                                                </div>
                                            </Option>
                                        ),
                                    )}
                                </Select>
                                <Image
                                    src={codeIcon}
                                    alt="Picture of the author"
                                    className={`${classes.evaluationImg} ${classes.customCodeIcon}`}
                                />
                            </div>
                        </Radio.Group>
                    </Col>
                    <Col span={8}>
                        <div className="evalaution-title">
                            <Title level={4}>2. Which variants would you like to evaluate</Title>
                        </div>

                        {Array.from({length: numberOfVariants}).map((_, index) => (
                            <Dropdown key={index} menu={getVariantsDropdownMenu(index)}>
                                <Button
                                    className={classes.variantDropdown}
                                    style={{
                                        marginTop: index === 0 ? 40 : 10,
                                    }}
                                    data-cy={`variants-dropdown-${index}`}
                                >
                                    <div className={classes.dropdownStyles}>
                                        {selectedVariants[index]?.variantName || "Select a variant"}
                                        <DownOutlined />
                                    </div>
                                </Button>
                            </Dropdown>
                        ))}
                    </Col>
                    <Col span={8}>
                        <div className="evalaution-title">
                            {" "}
                            <Title level={4}>3. Which testset you want to use?</Title>
                        </div>

                        <Dropdown menu={getTestsetDropdownMenu()}>
                            <Button className={classes.dropdownBtn} data-cy="selected-testset">
                                <div className={classes.dropdownStyles}>
                                    {selectedTestset.name}

                                    <DownOutlined />
                                </div>
                            </Button>
                        </Dropdown>
                    </Col>
                    <Col span={6}></Col>
                </Row>

                <Row justify="end" gutter={8}>
                    {selectedEvaluationType === EvaluationType.human_a_b_testing && isDemo() && (
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
                            data-cy="start-new-evaluation-button"
                        >
                            Start a new evaluation
                        </Button>
                    </Col>
                </Row>
            </div>
            <EvaluationErrorModal
                isModalOpen={!!error.message}
                onClose={() => setError({message: "", btnText: "", endpoint: ""})}
                handleNavigate={() => router.push(error.endpoint)}
                message={error.message}
                btnText={error.btnText}
            />
            <div>
                <AutomaticEvaluationResult />
                <HumanEvaluationResult />
            </div>

            <ShareEvaluationModal
                open={shareModalOpen}
                onCancel={() => setShareModalOpen(false)}
                destroyOnClose
                variantIds={selectedVariants.map((v) => v.variantId)}
                testsetId={selectedTestset._id}
                evaluationType={EvaluationType.human_a_b_testing}
            />
        </div>
    )
}
