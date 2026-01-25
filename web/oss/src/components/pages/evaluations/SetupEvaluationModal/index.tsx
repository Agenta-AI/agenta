import {useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {Book, Play} from "@phosphor-icons/react"
import {Button, ModalProps, Typography} from "antd"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import ApiKeyInput from "@/oss/components/pages/app-management/components/ApiKeyInput"
import {useStyles} from "@/oss/components/pages/app-management/modals/SetupTracingModal/assets/styles"
import {TracingCodeComponent} from "@/oss/components/pages/app-management/modals/SetupTracingModal/components/TracingCodeComponent"

const {Text, Title} = Typography

const CODE_SNIPPET = `import asyncio
import agenta as ag
from agenta.sdk.evaluations import aevaluate

# Initialize SDK
ag.init()

# Define test data
test_data = [
    {"country": "Germany", "capital": "Berlin"},
    {"country": "France", "capital": "Paris"},
    {"country": "Spain", "capital": "Madrid"},
    {"country": "Italy", "capital": "Rome"},
]

# Create application
@ag.application(
    slug="capital_finder",
    name="Capital Finder",
)
async def capital_finder(country: str):
    capitals = {
        "Germany": "Berlin",
        "France": "Paris",
        "Spain": "Madrid",
        "Italy": "Rome",
    }
    return capitals.get(country, "Unknown")

# Create evaluator
@ag.evaluator(
    slug="exact_match",
    name="Exact Match",
)
async def exact_match(capital: str, outputs: str):
    is_correct = outputs == capital
    return {
        "score": 1.0 if is_correct else 0.0,
        "success": is_correct,
    }

# Run evaluation
async def main():
    testset = await ag.testsets.acreate(
        name="Country Capitals",
        data=test_data,
    )

    result = await aevaluate(
        testsets=[testset.id],
        applications=[capital_finder],
        evaluators=[exact_match],
    )

    print(f"Evaluation complete!")

if __name__ == "__main__":
    asyncio.run(main())`

const SetupEvaluationModalContent = ({
    classes,
    onCancel,
}: {
    classes: ReturnType<typeof useStyles>
    onCancel: ModalProps["onCancel"]
}) => {
    const [apiKeyValue, setApiKeyValue] = useState("")

    return (
        <div className="h-full flex flex-col">
            <div className={classes.modalHeader}>
                <Button
                    onClick={() => onCancel?.({} as any)}
                    type="text"
                    icon={<CloseOutlined />}
                />
                <Text>Evaluate from SDK</Text>

                <div className="flex gap-2 items-center">
                    <Button
                        icon={<Play size={16} className="mt-1" />}
                        href="https://colab.research.google.com/github/agenta-ai/agenta/blob/main/examples/jupyter/evaluation/quick-start.ipynb"
                        target="_blank"
                    >
                        Run in colab
                    </Button>
                    <Button
                        target="_blank"
                        href="https://agenta.ai/docs/evaluation/evaluation-from-sdk/quick-start"
                        icon={<Book size={16} className="mt-1" />}
                    >
                        Read the docs
                    </Button>
                </div>
            </div>
            <div className={classes.modalBody}>
                <div className="flex flex-col gap-1 mb-4">
                    <Title style={{margin: 0}}>Evaluate from SDK</Title>
                    <Text>
                        Evaluate complex AI apps to compare changes and ensure they are reliable.
                    </Text>
                </div>

                <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />

                <div className="flex flex-col gap-4 mt-4">
                    <TracingCodeComponent
                        command={{
                            title: "Install the required packages",
                            code: "pip install -U agenta",
                        }}
                        index={0}
                    />
                    <TracingCodeComponent
                        command={{
                            title: "Run the evaluation",
                            code: CODE_SNIPPET,
                        }}
                        index={1}
                    />
                </div>
            </div>
        </div>
    )
}

const SetupEvaluationModal = (props: ModalProps) => {
    const classes = useStyles()

    return (
        <EnhancedModal
            footer={null}
            title={null}
            className={classes.modalContainer}
            width={720}
            closeIcon={null}
            styles={{
                container: {
                    height: 832,
                },
            }}
            {...props}
        >
            <SetupEvaluationModalContent classes={classes} onCancel={props.onCancel} />
        </EnhancedModal>
    )
}

export default SetupEvaluationModal
