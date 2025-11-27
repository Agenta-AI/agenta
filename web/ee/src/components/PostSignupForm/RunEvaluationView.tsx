import {useState} from "react"
import {Typography, Space, Button} from "antd"
import {CodeBlock} from "@phosphor-icons/react"
import {TracingCodeComponent} from "@/oss/components/pages/app-management/modals/SetupTracingModal/components/TracingCodeComponent"
import ApiKeyInput from "@/oss/components/pages/app-management/components/ApiKeyInput"
import {useRouter} from "next/router"

const {Title, Text} = Typography

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

export const RunEvaluationView = () => {
    const [apiKeyValue, setApiKeyValue] = useState("")
    const router = useRouter()

    return (
        <div className="flex flex-col gap-6">
            <Space direction="vertical">
                <Title level={3}>Run an evaluation from SDK</Title>
                <Text>
                    Measure app performance: identify failures, compare changes, ensure reliability.
                </Text>
            </Space>

            <div className="flex items-center gap-4">
                <Button 
                    href="https://colab.research.google.com/github/agenta-ai/agenta/blob/main/examples/jupyter/evaluation/quick-start.ipynb" 
                    target="_blank"
                >
                    Open in Google Colab
                </Button>
            </div>

            <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />
            
            <div className="flex flex-col gap-2">
                <Text strong>1. Install the required packages:</Text>
                <TracingCodeComponent 
                    command={{
                        title: "Bash",
                        code: "pip install -U agenta"
                    }} 
                    index={0} 
                />
            </div>

            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <CodeBlock size={20} />
                    <Text strong>2. Complete Example</Text>
                </div>
                <TracingCodeComponent 
                    command={{
                        title: "Python SDK",
                        code: CODE_SNIPPET
                    }} 
                    index={1} 
                />
            </div>

        </div>
    )
}
