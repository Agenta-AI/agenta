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
    message,
} from "antd"
import {DownOutlined} from "@ant-design/icons"
import {createNewEvaluation, fetchVariants, useLoadTestsetsList} from "@/lib/services/api"
import {getOpenAIKey} from "@/lib/helpers/utils"
import {useRouter} from "next/router"
import {Variant, Parameter, GenericObject} from "@/lib/Types"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
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
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"
import AutomaticEvaluationResult from "./AutomaticEvaluationResult"
import HumanEvaluationResult from "./HumanEvaluationResult"
import EvaluationDropdown from "./CustomEvaluationsDropdown"
import axios from "axios"
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
    evaluationBtn: {
        display: "flex",
        justifyContent: "flex-end",
    },
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
    },
    thresholdStyles: {
        paddingLeft: 10,
        paddingRight: 10,
    },
    variantDropdown: {
        marginRight: 10,
        width: "100%",
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

    const appName = router.query.app_name?.toString() || ""

    const {testsets, isTestsetsLoading, isTestsetsLoadingError} = useLoadTestsetsList(appName)

    const [variantsInputs, setVariantsInputs] = useState<Record<string, string[]>>({})

    const [error, setError] = useState({message: "", btnText: "", endpoint: ""})

    const [llmAppPromptTemplate, setLLMAppPromptTemplate] = useState("")

    useEffect(() => {
        const fetchData = async () => {
            try {
                const backendVariants = await fetchVariants(appName)

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
    }, [appName])

    useEffect(() => {
        if (variants.length > 0) {
            const fetchAndSetSchema = async () => {
                try {
                    // Map the variants to an array of promises
                    const promises = variants.map((variant) =>
                        getAllVariantParameters(appName, variant).then(({inputs}) => ({
                            variantName: variant.variantName,
                            inputs: inputs.map((inputParam: Parameter) => inputParam.name),
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
    }, [appName, variants])

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
                label: testset.name,
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
        const items: MenuProps["items"] = variants.map((variant) => {
            return {
                label: variant.variantName,
                key: variant.variantName,
            }
        })
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
        } else if (
            getOpenAIKey() === "" &&
            selectedEvaluationType === EvaluationType.auto_ai_critique
        ) {
            setError({
                message:
                    "In order to run an AI Critique evaluation, please set your OpenAI API key in the API Keys page.",
                btnText: "Go to API Keys",
                endpoint: "apikeys",
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
            variants: selectedVariants.map((variant) => variant.variantName),
            appName,
            inputs: variantsInputs[selectedVariants[0].variantName],
            evaluationType: EvaluationType[selectedEvaluationType as keyof typeof EvaluationType],
            evaluationTypeSettings,
            llmAppPromptTemplate,
            selectedCustomEvaluationID,
            testset: {
                _id: selectedTestset._id!,
                name: selectedTestset.name,
            },
        }).catch((err) => {
            setError({
                message: getErrorMessage(err),
                btnText: "Go to Test sets",
                endpoint: "testsets",
            })
        })

        if (!evaluationTableId) {
            return
        }

        // 3 We set the variants
        setVariants(selectedVariants)

        if (selectedEvaluationType === EvaluationType.auto_exact_match) {
            router.push(`/apps/${appName}/evaluations/${evaluationTableId}/auto_exact_match`)
        } else if (selectedEvaluationType === EvaluationType.human_a_b_testing) {
            router.push(`/apps/${appName}/evaluations/${evaluationTableId}/human_a_b_testing`)
        } else if (selectedEvaluationType === EvaluationType.auto_similarity_match) {
            router.push(`/apps/${appName}/evaluations/${evaluationTableId}/similarity_match`)
        } else if (selectedEvaluationType === EvaluationType.auto_regex_test) {
            router.push(`/apps/${appName}/evaluations/${evaluationTableId}/auto_regex_test`)
        } else if (selectedEvaluationType === EvaluationType.auto_webhook_test) {
            router.push(`/apps/${appName}/evaluations/${evaluationTableId}/auto_webhook_test`)
        } else if (selectedEvaluationType === EvaluationType.auto_ai_critique) {
            router.push(`/apps/${appName}/evaluations/${evaluationTableId}/auto_ai_critique`)
        } else if (selectedEvaluationType === EvaluationType.custom_code_run) {
            router.push(
                `/apps/${appName}/evaluations/${evaluationTableId}/custom_code_run?custom_eval_id=${selectedCustomEvaluationID}`,
            )
        }
    }

    const onChangeEvaluationType = (e: RadioChangeEvent) => {
        const evaluationType = e.target.value
        setSelectedEvaluationType(evaluationType)
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

    const onChangeSlider = (value: number) => {
        setSliderValue(value)
    }

    const redirectToCreateCustomEvaluation = () => {
        router.push(`/apps/${appName}/evaluations/create_custom_evaluation`)
    }

    return (
        <div>
            <div>
                {typeof isError === "string" && <div>{isError}</div>}
                {areAppVariantsLoading && <div>loading variants...</div>}
            </div>
            <div className={classes.evaluationContainer}>
                <Row justify="start" gutter={24}>
                    <Col span={8}>
                        <Title level={4}>1. Select an evaluation type</Title>
                        <Title level={5}>Human evaluation</Title>
                        <Radio.Group
                            onChange={(e) => onChangeEvaluationType(e)}
                            className={classes.radioGroup}
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
                                <div className={classes.evaluationType}>
                                    <Image
                                        src={exactMatch}
                                        alt="Picture of the author"
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
                                        alt="Picture of the author"
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
                                <div className={classes.evaluationType}>
                                    <Image
                                        src={regexIcon}
                                        alt="Picture of the author"
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
                                        alt="Picture of the author"
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
                                <div className={classes.evaluationType}>
                                    <Image
                                        src={ai}
                                        alt="Picture of the author"
                                        className={classes.evaluationImg}
                                    />

                                    <span>
                                        {EvaluationTypeLabels[EvaluationType.auto_ai_critique]}
                                    </span>
                                </div>
                            </Radio.Button>

                            {/* Custom Evaluation Dropdown */}
                            <EvaluationDropdown
                                classes={classes}
                                appName={appName}
                                setEvalType={setSelectedEvaluationType}
                                setEvalID={setSelectedCustomEvaluationID}
                            />
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
                            <Button className={classes.dropdownBtn}>
                                <div className={classes.dropdownStyles}>
                                    {selectedTestset.name}

                                    <DownOutlined />
                                </div>
                            </Button>
                        </Dropdown>
                    </Col>
                    <Col span={6}></Col>
                </Row>

                <Row justify="end">
                    <Col span={8} className={classes.evaluationBtn}>
                        <Button
                            onClick={redirectToCreateCustomEvaluation}
                            type="default"
                            data-evaluation-type={EvaluationType.custom_code_run}
                            className={classes.createCustomEvalBtn}
                        >
                            Create custom evaluation
                        </Button>

                        <Button onClick={onStartEvaluation} type="primary">
                            Start a new evaluation
                        </Button>
                    </Col>
                </Row>
            </div>
            <EvaluationErrorModal
                isModalOpen={!!error.message}
                onClose={() => setError({message: "", btnText: "", endpoint: ""})}
                handleNavigate={() => router.push(`/apps/${appName}/${error.endpoint}`)}
                message={error.message}
                btnText={error.btnText}
            />
            <div>
                <AutomaticEvaluationResult />
                <HumanEvaluationResult />
            </div>
        </div>
    )
}
