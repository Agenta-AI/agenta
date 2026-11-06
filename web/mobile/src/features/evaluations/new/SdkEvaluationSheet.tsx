import {useState} from "react"

import {createApiKey} from "@agenta/settings"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    Input,
    LoadingButton,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"
import {Book, Copy, Play} from "@phosphor-icons/react"

import {SHEET_FRAME} from "./sheetFrame"

const COLAB_HREF =
    "https://colab.research.google.com/github/agenta-ai/agenta/blob/main/examples/jupyter/evaluation/quick-start.ipynb"
const DOCS_HREF = "https://agenta.ai/docs/evaluation/evaluation-from-sdk/quick-start"

const INSTALL_CODE = "pip install -U agenta"

const RUN_CODE = `import asyncio
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

const copyText = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text)
        message.success("Copied")
    } catch {
        // `navigator.clipboard` is undefined outside a secure context.
        message.error("Couldn't copy")
    }
}

const CodeStep = ({index, title, code}: {index: number; title: string; code: string}) => (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-sm text-foreground">
                {index}. {title}
            </p>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Copy: ${title}`}
                onClick={() => void copyText(code)}
            >
                <Copy aria-hidden size={14} />
            </Button>
        </div>
        <pre className="m-0 max-h-[360px] overflow-auto rounded-lg bg-muted p-3 font-mono text-[12px] leading-[1.5] text-foreground">
            {code}
        </pre>
    </div>
)

/**
 * The SDK evaluation setup: an API key, the install command and a script to run. The run is the
 * reader's own, so the sheet starts nothing and has no route. The runs list opens it.
 */
export const SdkEvaluationSheet = ({
    open,
    workspaceId,
    projectId,
    onClose,
}: {
    open: boolean
    workspaceId: string
    projectId: string
    onClose: () => void
}) => {
    const [apiKey, setApiKey] = useState("")
    const [isGenerating, setIsGenerating] = useState(false)

    const generate = async () => {
        setIsGenerating(true)
        try {
            const key = await createApiKey(workspaceId, projectId)
            if (!key) throw new Error("No key returned")
            setApiKey(key)
            message.success("API key generated")
        } catch {
            message.error("Couldn't generate the API key")
        } finally {
            setIsGenerating(false)
        }
    }

    return (
        <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
            <SheetContent {...SHEET_FRAME}>
                <SheetHeader>
                    <SheetTitle>Evaluate from SDK</SheetTitle>
                    <SheetDescription>
                        Evaluate complex AI apps to compare changes and ensure they are reliable.
                    </SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                            <a href={COLAB_HREF} target="_blank" rel="noreferrer">
                                <Play aria-hidden size={14} />
                                Run in colab
                            </a>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                            <a href={DOCS_HREF} target="_blank" rel="noreferrer">
                                <Book aria-hidden size={14} />
                                Read the docs
                            </a>
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label htmlFor="sdk-evaluation-api-key" className="text-sm font-medium">
                            Create or enter your API key
                        </label>
                        <div className="flex gap-2">
                            <Input
                                id="sdk-evaluation-api-key"
                                value={apiKey}
                                placeholder="Enter existing API key"
                                onChange={(event) => setApiKey(event.target.value)}
                            />
                            <LoadingButton
                                type="button"
                                variant="outline"
                                loading={isGenerating}
                                onClick={() => void generate()}
                            >
                                Generate API Key
                            </LoadingButton>
                        </div>
                    </div>
                    <CodeStep index={1} title="Install the required packages" code={INSTALL_CODE} />
                    <CodeStep index={2} title="Run the evaluation" code={RUN_CODE} />
                </div>
            </SheetContent>
        </Sheet>
    )
}
