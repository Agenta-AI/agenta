import {useState, type ReactNode} from "react"

import {Robot, ArrowLeft, ArrowRight, Check} from "@phosphor-icons/react"
import {Button, Input} from "antd"

import {
    firstAgentInput,
    roles,
    sources,
    suggestionsForRole,
    type OnboardingVariant,
} from "./choices"

export interface OnboardingFlowViewProps {
    variant: OnboardingVariant
    tools: ReactNode
    model: ReactNode
    modelReady: boolean
    committing: boolean
    onCreate: (input: {name: string; seedMessage: string}) => void
    onStep: (step: number, answers: {role: string; source: string}) => void
}

export default function OnboardingFlowView({
    variant,
    tools,
    model,
    modelReady,
    committing,
    onCreate,
    onStep,
}: OnboardingFlowViewProps) {
    const [step, setStep] = useState(1)
    const [role, setRole] = useState("")
    const [source, setSource] = useState("")
    const [name, setName] = useState("")
    const [task, setTask] = useState("")
    const [templateKey, setTemplateKey] = useState<string | null>(null)
    const templates = suggestionsForRole(role)
    const selected = templates.find((item) => item.key === templateKey)
    const input = firstAgentInput(variant, name, task, templateKey)
    const nextEnabled = step === 1 ? !!role : step === 2 ? !!source : step === 4 ? modelReady : true
    const title = [
        "",
        "What kind of work do you do?",
        "How did you hear about Agenta?",
        "Connect your tools",
        "Choose how to run your agent",
        variant === "control" ? "Create your first agent" : "What should your first agent do?",
    ][step]
    const subtitle = [
        "",
        "We'll suggest a few useful starting points.",
        "Help us understand how people find us.",
        "Connect the apps your agent will use. You can also do this later.",
        "Use available credits, your ChatGPT subscription, or a provider key.",
        "Pick a starting point. You can change everything later.",
    ][step]
    const move = (next: number) => {
        onStep(step, {role, source})
        setStep(next)
    }
    const choiceClass = (active: boolean) =>
        `rounded-xl border border-solid p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "border-colorText bg-colorFillTertiary" : "border-colorBorderSecondary bg-colorBgContainer hover:bg-colorFillQuaternary"}`

    return (
        <main className="flex h-full min-h-0 flex-col overflow-auto bg-colorBgLayout text-colorText">
            <header className="flex items-center justify-between px-6 py-5">
                <span className="flex items-center gap-2 text-lg font-semibold">
                    <Robot size={24} weight="fill" /> agenta
                </span>
                <span className="text-sm text-colorTextSecondary">Step {step} of 5</span>
            </header>
            <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-6 py-8 md:py-12">
                <div className="mb-9 flex gap-2" aria-label={`Step ${step} of 5`}>
                    {[1, 2, 3, 4, 5].map((item) => (
                        <div
                            key={item}
                            className={`h-1 flex-1 rounded-full ${item <= step ? "bg-colorText" : "bg-colorBorderSecondary"}`}
                        />
                    ))}
                </div>
                <h1 className="mb-2 text-3xl font-semibold">{title}</h1>
                <p className="mb-8 text-colorTextSecondary">{subtitle}</p>
                {(step === 1 || step === 2) && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                        {(step === 1 ? roles : sources).map((label) => (
                            <button
                                type="button"
                                key={label}
                                aria-pressed={(step === 1 ? role : source) === label}
                                className={choiceClass((step === 1 ? role : source) === label)}
                                onClick={() => {
                                    if (step === 1) {
                                        setRole(label)
                                        setTemplateKey(null)
                                        setTask("")
                                        setName("")
                                    } else setSource(label)
                                }}
                            >
                                <span className="flex min-h-12 items-center justify-between gap-3">
                                    {label}
                                    {(step === 1 ? role : source) === label && <Check size={18} />}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                {step === 3 && tools}
                {step === 4 && model}
                {step === 5 && (
                    <div
                        className={`grid gap-6 ${variant === "task-first" ? "md:grid-cols-2" : ""}`}
                    >
                        <div className="flex flex-col gap-4">
                            {variant === "control" && (
                                <label className="flex flex-col gap-2 font-medium">
                                    Agent name
                                    <Input
                                        size="large"
                                        value={name}
                                        maxLength={100}
                                        onChange={(event) => setName(event.target.value)}
                                        placeholder="Give your agent a name"
                                    />
                                </label>
                            )}
                            <div className="flex flex-col gap-2">
                                {templates.map((template) => (
                                    <button
                                        key={template.key}
                                        type="button"
                                        className={choiceClass(templateKey === template.key)}
                                        aria-pressed={templateKey === template.key}
                                        onClick={() => {
                                            setTemplateKey(template.key)
                                            setName(template.name)
                                            setTask("")
                                        }}
                                    >
                                        <strong className="block">
                                            {variant === "control"
                                                ? template.name
                                                : (template.example?.prompt ?? template.name)}
                                        </strong>
                                        <span className="mt-1 block text-sm text-colorTextSecondary">
                                            {template.description}
                                        </span>
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    className={choiceClass(!templateKey)}
                                    aria-pressed={!templateKey}
                                    onClick={() => {
                                        setTemplateKey(null)
                                        setTask("")
                                    }}
                                >
                                    Something else
                                </button>
                            </div>
                            {!templateKey && (
                                <label className="flex flex-col gap-2">
                                    What would you like it to do?
                                    <Input.TextArea
                                        rows={4}
                                        value={task}
                                        onChange={(event) => setTask(event.target.value)}
                                        maxLength={10000}
                                        placeholder="For example, help me plan my week."
                                    />
                                </label>
                            )}
                        </div>
                        {variant === "task-first" && (
                            <aside className="rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer p-5">
                                <Robot size={32} weight="fill" />
                                <h2 className="mt-3 text-xl font-semibold">
                                    {selected?.name ?? "Your first agent"}
                                </h2>
                                <p className="text-colorTextSecondary">
                                    {selected?.description ??
                                        "Describe a task and your agent will help you get started."}
                                </p>
                                {selected?.example && (
                                    <div className="mt-6 border-t border-solid border-colorBorderSecondary pt-4">
                                        <h3 className="text-sm font-semibold">Example run</h3>
                                        <p className="text-xs text-colorTextSecondary">
                                            Illustration only. Your agent hasn't run yet.
                                        </p>
                                        <ol className="my-4 list-decimal space-y-2 pl-5 text-sm">
                                            {selected.example.steps.map((text) => (
                                                <li key={text}>{text}</li>
                                            ))}
                                        </ol>
                                        <p className="rounded-lg bg-colorFillQuaternary p-3 text-sm">
                                            {selected.example.reply}
                                        </p>
                                    </div>
                                )}
                            </aside>
                        )}
                    </div>
                )}
                <footer className="mt-10 flex items-center justify-between gap-4 border-t border-solid border-colorBorderSecondary pt-5">
                    <Button
                        icon={<ArrowLeft />}
                        onClick={() => move(step - 1)}
                        disabled={step === 1 || committing}
                    >
                        Back
                    </Button>
                    {step < 5 ? (
                        <Button
                            type="primary"
                            size="large"
                            icon={<ArrowRight />}
                            iconPlacement="end"
                            disabled={!nextEnabled}
                            onClick={() => move(step + 1)}
                        >
                            {step === 3 ? "Continue" : "Next"}
                        </Button>
                    ) : (
                        <Button
                            type="primary"
                            size="large"
                            loading={committing}
                            disabled={!input || !modelReady}
                            onClick={() => {
                                if (input) onCreate(input)
                            }}
                        >
                            Create agent
                        </Button>
                    )}
                </footer>
                {step === 5 && (
                    <p className="mt-3 text-right text-xs text-colorTextSecondary">
                        Create saves your agent and sends its first message.
                    </p>
                )}
            </div>
        </main>
    )
}
