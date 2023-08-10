import {useState, useEffect} from "react"
import {
    Button,
    Col,
    Dropdown,
    MenuProps,
    Radio,
    RadioChangeEvent,
    Row,
    Tag,
    Slider,
    message,
} from "antd"
import {DownOutlined} from "@ant-design/icons"
import {
    fetchVariants,
    getVariantParametersFromOpenAPI,
    useLoadTestsetsList,
} from "@/lib/services/api"
import {useRouter} from "next/router"
import {Variant, Parameter} from "@/lib/Types"
import EvaluationsList from "./EvaluationsList"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {EvaluationTypeLabels} from "@/lib/helpers/utils"
import {Typography} from "antd"
import EvaluationErrorModal from "./EvaluationErrorModal"
import {getAllVariantParameters} from "@/lib/helpers/variantHelper"

export default function Evaluations() {
    const {Text, Title} = Typography
    const router = useRouter()
    const [areAppVariantsLoading, setAppVariantsLoading] = useState(false)
    const [isError, setIsError] = useState<boolean | string>(false)
    const [variants, setVariants] = useState<any[]>([])

    const [columnsCount, setColumnsCount] = useState(2)
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

    const appName = router.query.app_name?.toString() || ""

    const {testsets, isTestsetsLoading, isTestsetsLoadingError} = useLoadTestsetsList(appName)

    const [variantsInputs, setVariantsInputs] = useState<Record<string, string[]>>({})

    const [sliderValue, setSliderValue] = useState(0.3)

    const [evaluationError, setEvaluationError] = useState("")

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
                        (acc, result) => {
                            acc[result.variantName] = result.inputs
                            return acc
                        },
                        {},
                    )

                    setVariantsInputs(newVariantsInputs)
                } catch (e) {
                    setIsError("Failed to fetch some variants parameters. Error: " + e.message)
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

    // TODO: move to api.ts
    const createNewEvaluation = async (
        evaluationType: string,
        evaluationTypeSettings: any,
        inputs: string[],
    ) => {
        const postData = async (url = "", data = {}) => {
            const response = await fetch(url, {
                method: "POST",
                cache: "no-cache",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                },
                redirect: "follow",
                referrerPolicy: "no-referrer",
                body: JSON.stringify(data),
            })

            if (!response.ok) {
                throw new Error((await response.json())?.detail ?? "Failed to create evaluation")
            }

            return response.json()
        }

        const data = {
            variants: selectedVariants.map((variant) => variant.variantName), // TODO: Change to variant id
            app_name: appName,
            inputs: inputs,
            evaluation_type: evaluationType,
            evaluation_type_settings: evaluationTypeSettings,
            testset: {
                _id: selectedTestset._id,
                name: selectedTestset.name,
            },
            status: EvaluationFlow.EVALUATION_FINISHED,
        }

        return postData(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/`, data)
            .then((data) => {
                return data.id
            })
            .catch((err) => {
                setEvaluationError(err.message)
            })
    }

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
                const index = items.findIndex((item) => item.key === key)
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
        } else if (selectedEvaluationType === "Select an evaluation type") {
            message.error("Please select an evaluation type")
            return
        } else if (selectedTestset?.name === "Select a Test set") {
            message.error("Please select a testset")
            return
        }

        // 2. We create a new app evaluation
        const evaluationTypeSettings: any = {}
        if (selectedEvaluationType === EvaluationType.auto_similarity_match) {
            evaluationTypeSettings["similarity_threshold"] = sliderValue
        }
        const evaluationTableId = await createNewEvaluation(
            EvaluationType[selectedEvaluationType],
            evaluationTypeSettings,
            variantsInputs[selectedVariants[0].variantName],
        )
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

    return (
        <div>
            <div>
                {typeof isError === "string" && <div>{isError}</div>}
                {areAppVariantsLoading && <div>loading variants...</div>}
            </div>
            <div
                style={{
                    border: "1px solid lightgrey",
                    padding: "20px",
                    borderRadius: "14px",
                    marginBottom: 50,
                }}
            >
                <Row justify="start" gutter={24}>
                    <Col span={8}>
                        <Title level={4}>1. Select an evaluation type</Title>
                        <Title level={5}>Human evaluation</Title>
                        <Radio.Group
                            onChange={(e) => onChangeEvaluationType(e)}
                            style={{width: "100%"}}
                        >
                            <Radio.Button
                                value={EvaluationType.human_a_b_testing}
                                style={{display: "block", marginBottom: "10px"}}
                            >
                                {EvaluationTypeLabels[EvaluationType.human_a_b_testing]}
                            </Radio.Button>
                            <Radio.Button
                                value={EvaluationType.human_scoring}
                                disabled
                                style={{display: "block", marginBottom: "10px"}}
                            >
                                {EvaluationTypeLabels[EvaluationType.human_scoring]}
                                <Tag color="orange" bordered={false}>
                                    soon
                                </Tag>
                            </Radio.Button>

                            <Title level={5}>Automatic evaluation</Title>

                            <Radio.Button
                                value={EvaluationType.auto_exact_match}
                                style={{display: "block", marginBottom: "10px"}}
                            >
                                {EvaluationTypeLabels[EvaluationType.auto_exact_match]}
                            </Radio.Button>
                            <Radio.Button
                                value={EvaluationType.auto_similarity_match}
                                style={{display: "block", marginBottom: "10px"}}
                            >
                                {EvaluationTypeLabels[EvaluationType.auto_similarity_match]}
                            </Radio.Button>
                            {selectedEvaluationType === EvaluationType.auto_similarity_match && (
                                <div style={{paddingLeft: 10, paddingRight: 10}}>
                                    <Text>Similarity threshold</Text>
                                    <Slider
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        defaultValue={sliderValue}
                                        onChange={onChangeSlider}
                                    />
                                </div>
                            )}
                            <Radio.Button
                                value={EvaluationType.auto_ai_critique}
                                disabled
                                style={{display: "block", marginBottom: "10px"}}
                            >
                                {EvaluationTypeLabels[EvaluationType.auto_ai_critique]}
                                <Tag color="orange" bordered={false}>
                                    soon
                                </Tag>
                            </Radio.Button>
                        </Radio.Group>
                    </Col>
                    <Col span={8}>
                        <div className="evalaution-title">
                            <Title level={4}>2. Which variants would you like to evaluate</Title>
                        </div>

                        {Array.from({length: numberOfVariants}).map((_, index) => (
                            <Dropdown key={index} menu={getVariantsDropdownMenu(index)}>
                                <Button
                                    style={{
                                        marginRight: 10,
                                        marginTop: index === 0 ? 40 : 10,
                                        width: "100%",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            width: "100%",
                                        }}
                                    >
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
                            <Button style={{marginRight: 10, marginTop: 40, width: "100%"}}>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        width: "100%",
                                    }}
                                >
                                    {selectedTestset.name}

                                    <DownOutlined />
                                </div>
                            </Button>
                        </Dropdown>
                    </Col>
                    <Col span={6}></Col>
                </Row>

                <Row justify="end">
                    <Col span={8} style={{display: "flex", justifyContent: "flex-end"}}>
                        <Button onClick={onStartEvaluation} type="primary">
                            Start a new evaluation
                        </Button>
                    </Col>
                </Row>
            </div>
            <EvaluationErrorModal
                isModalOpen={!!evaluationError}
                onClose={() => setEvaluationError("")}
                handleNavigate={() => router.push(`/apps/${appName}/testsets`)}
                message={evaluationError}
            />

            <EvaluationsList />
        </div>
    )
}
