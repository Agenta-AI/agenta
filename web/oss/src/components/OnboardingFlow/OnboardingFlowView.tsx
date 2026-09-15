import {useEffect, useMemo, useState, type ReactNode} from "react"

import {
    Robot,
    ArrowLeft,
    ArrowRight,
    Check,
    Code,
    Lightbulb,
    Target,
    Megaphone,
    Headset,
    GearSix,
    ChartBar,
    Briefcase,
    DotsThree,
    GithubLogo,
    GitPullRequest,
    Bug,
    Lightning,
    ChatCircleDots,
    Notebook,
    MagnifyingGlass,
    Sparkle,
    XLogo,
    Users,
    Newspaper,
    RedditLogo,
} from "@phosphor-icons/react"
import {Button, Input} from "antd"
import Image from "next/image"

import {
    firstAgentInput,
    roles,
    sources,
    suggestionsForRole,
    type OnboardingVariant,
} from "./choices"
import {readOnboardingDraft, saveOnboardingDraft} from "./draft"

const templateIcons = [GitPullRequest, Bug, Lightning, ChatCircleDots, Notebook]

const Radio = ({active}: {active: boolean}) => (
    <span
        aria-hidden
        className={`ml-auto size-4 shrink-0 rounded-full border-solid ${active ? "border-[5px] border-colorText" : "border border-colorBorderSecondary"}`}
    />
)

export interface OnboardingFlowViewProps {
    draftKey?: string
    variant: OnboardingVariant
    tools: ReactNode | ((ids: string[], onChange: (ids: string[]) => void) => ReactNode)
    identity?: ReactNode
    model: ReactNode
    modelNextLabel?: string
    modelReady: boolean
    committing: boolean
    onCreate: (input: {name: string; seedMessage: string; connectionIds?: string[]}) => void
    onStep: (step: number, answers: {role: string; source: string}) => void
    /** A suggestion was picked — the owner refreshes the agent's icon and color to match. */
    onTemplate?: (index: number) => void
}

export default function OnboardingFlowView({
    draftKey,
    variant,
    tools,
    model,
    identity,
    modelReady,
    modelNextLabel = "Next",
    committing,
    onCreate,
    onStep,
    onTemplate,
}: OnboardingFlowViewProps) {
    const draft = useMemo(() => readOnboardingDraft(draftKey), [draftKey])
    const [connectionIds, setConnectionIds] = useState(draft.connectionIds ?? [])
    const [step, setStep] = useState(draft.step ?? 1)
    const [role, setRole] = useState(draft.role ?? "")
    const [source, setSource] = useState(draft.source ?? "")
    const [name, setName] = useState(draft.name ?? "")
    const [task, setTask] = useState(draft.task ?? "")
    const [templateKey, setTemplateKey] = useState<string | null>(draft.templateKey ?? null)
    useEffect(() => {
        saveOnboardingDraft(draftKey, {step, role, source, name, task, templateKey, connectionIds})
    }, [draftKey, step, role, source, name, task, templateKey, connectionIds])
    const templates = suggestionsForRole(role)
    const custom = templateKey === "__custom__"
    const selected = templates.find((item) => item.key === templateKey)
    const input = firstAgentInput(variant, name, task, templateKey)
    const nextEnabled = step === 1 ? !!role : step === 3 ? modelReady : step === 4 ? !!source : true
    const title = [
        "",
        "What will you be working on most?",
        "What do you use every day?",
        "Choose how to run your agent",
        "How did you hear about Agenta?",
        variant === "control" ? "Create your first agent" : "What would you like done first?",
    ][step]
    const subtitle = [
        "",
        "We'll suggest agents that fit how you work.",
        "Connect the apps your agents should work in.",
        "Use available credits, your ChatGPT subscription, or a provider key.",
        "One pick is enough.",
        "Pick a starting point. You can change everything later.",
    ][step]
    const move = (next: number) => {
        if (next > step) onStep(step, {role, source})
        setStep(next)
    }
    const taskTitles: Record<string, string> = {
        "PR reviewer": "Review my open pull requests",
        "Issue triage": "Triage new issues",
        "CI failure triage": "Explain CI failures",
        "Changelog writer": "Write this week's changelog",
    }
    const choiceClass = (active: boolean) =>
        `rounded-xl border border-solid p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "border-colorText bg-colorFillTertiary" : "border-colorBorderSecondary bg-colorBgContainer hover:bg-colorFillQuaternary"}`

    const icons =
        step === 1
            ? [Code, Lightbulb, Target, Megaphone, Headset, GearSix, ChartBar, Briefcase, DotsThree]
            : [GithubLogo, MagnifyingGlass, Sparkle, XLogo, Users, Newspaper, RedditLogo, DotsThree]
    const choiceStep = step === 1 || step === 4
    const tones = [
        "bg-[var(--ag-preset-purple-bg)] text-[var(--ag-preset-purple-text)]",
        "bg-[var(--ag-preset-cyan-bg)] text-[var(--ag-preset-cyan-text)]",
        "bg-[var(--ag-preset-orange-bg)] text-[var(--ag-preset-orange-text)]",
        "bg-[var(--ag-preset-green-bg)] text-[var(--ag-preset-green-text)]",
        "bg-[var(--ag-preset-red-bg)] text-[var(--ag-preset-red-text)]",
        "bg-colorFillSecondary text-colorText",
    ]
    const createButton = (
        <Button
            type="primary"
            size="large"
            loading={committing}
            disabled={!input || !modelReady}
            onClick={() => {
                if (input) onCreate({...input, ...(connectionIds.length ? {connectionIds} : {})})
            }}
        >
            {variant === "control" ? "Get started" : "Set up this agent"}
        </Button>
    )
    return (
        <main className="flex h-full min-h-0 flex-col items-center overflow-auto bg-colorBgContainer pb-12 text-colorText">
            <header className="mt-8 flex w-[90%] max-w-[1200px] items-center justify-between">
                <span className="flex items-center gap-2 text-2xl font-semibold">
                    <svg viewBox="0 0 171 140" width="30" height="28" aria-hidden="true">
                        <path
                            fill="currentColor"
                            d="M115.504 95.9335C115.221 98.4384 116.607 99.1695 118.671 98.2233C124.787 95.4184 149.253 82.6572 162.347 82.6572C166.663 82.6572 184.04 84.7181 149.838 117.918C121.062 145.85 113.265 139.835 111.236 137.807C105.889 132.459 108.817 117.798 109.715 110.453C110.039 107.807 109.134 106.985 106.571 108.131C83.5096 118.441 40.4169 140 16.5021 140C-29.3433 140 33.8427 64.9164 43.6743 52.9651C76.3083 13.2951 97.3726 0 109.234 0C130.713 0 121.893 39.2078 115.504 95.9335Z"
                        />
                    </svg>
                    Agenta
                </span>
                <span className="text-sm text-colorTextSecondary">Step {step} of 5</span>
            </header>
            <div
                className="mt-5 flex w-[90%] max-w-[1200px] gap-2"
                aria-label={`Step ${step} of 5`}
            >
                {[1, 2, 3, 4, 5].map((item) => (
                    <div
                        key={item}
                        className={`h-[3px] flex-1 rounded-full ${item <= step ? "bg-colorText" : "bg-colorBorderSecondary"}`}
                    />
                ))}
            </div>
            <div
                className={`flex w-[92%] flex-col ${step === 5 ? "max-w-[1200px]" : step === 3 ? "max-w-[600px]" : "max-w-[700px]"}`}
            >
                {step !== 3 && step < 5 && (
                    <>
                        <h1 className="mb-2 mt-16 text-center text-[30px] font-semibold leading-tight">
                            {title}
                        </h1>
                        <p className="mb-9 text-center text-[15px] text-colorTextSecondary">
                            {subtitle}
                        </p>
                    </>
                )}
                {choiceStep && (
                    <div
                        className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${step === 1 ? "md:grid-cols-3" : ""}`}
                    >
                        {(step === 1 ? roles : sources).map((label, index) => {
                            const Icon = icons[index]
                            const active = (step === 1 ? role : source) === label
                            return (
                                <button
                                    type="button"
                                    key={label}
                                    aria-pressed={active}
                                    className={`${choiceClass(active)} relative flex ${step === 1 ? "h-[124px] flex-col items-start justify-between" : "h-16 items-center gap-3"}`}
                                    onClick={() => {
                                        if (step === 1) {
                                            setRole(label)
                                            setTemplateKey(null)
                                            setTask("")
                                            setName("")
                                        } else setSource(label)
                                    }}
                                >
                                    <span
                                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${tones[index % tones.length]}`}
                                    >
                                        <Icon size={20} weight="fill" />
                                    </span>
                                    <span className="text-[15px]">{label}</span>
                                    {active && (
                                        <Check size={14} className="absolute right-2 top-2" />
                                    )}
                                </button>
                            )
                        })}
                    </div>
                )}
                {step === 2 &&
                    (typeof tools === "function" ? tools(connectionIds, setConnectionIds) : tools)}
                {step === 3 && <div className="mt-14">{model}</div>}
                {step === 5 && variant === "control" && (
                    <>
                        <div className="flex min-h-[440px] flex-col items-center justify-center pt-6">
                            {identity ?? (
                                <Robot size={96} weight="fill" className="mb-6 text-colorPrimary" />
                            )}
                            <label className="flex w-full max-w-[440px] flex-col gap-2 text-sm text-colorTextSecondary">
                                Name
                                <Input
                                    size="large"
                                    value={name}
                                    maxLength={100}
                                    onChange={(event) => setName(event.target.value)}
                                    placeholder="New agent"
                                />
                            </label>
                            <div className="mt-6">{createButton}</div>
                        </div>
                        <p className="mb-3 text-sm text-colorTextSecondary">
                            Suggestions for {role}
                        </p>
                        <div className="flex gap-3 overflow-x-auto pb-2">
                            {templates.map((template, index) => {
                                const TemplateIcon = templateIcons[index % templateIcons.length]
                                return (
                                    <button
                                        key={template.key}
                                        type="button"
                                        aria-pressed={templateKey === template.key}
                                        className={`${choiceClass(templateKey === template.key)} flex w-[300px] shrink-0 items-start gap-3`}
                                        onClick={() => {
                                            setTemplateKey(template.key)
                                            setName(template.name)
                                            setTask("")
                                        }}
                                    >
                                        <span
                                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${tones[index % tones.length]}`}
                                        >
                                            <TemplateIcon size={20} weight="fill" />
                                        </span>
                                        <span>
                                            <strong className="block text-[15px]">
                                                {template.name}
                                            </strong>
                                            <span className="mt-1 block text-xs text-colorTextSecondary">
                                                {template.description}
                                            </span>
                                            <span className="mt-2 flex gap-1">
                                                {template.logoSlugs?.map((slug) => (
                                                    <Image
                                                        key={slug}
                                                        src={`https://logos.composio.dev/api/${slug}`}
                                                        alt={slug}
                                                        width={16}
                                                        height={16}
                                                        unoptimized
                                                    />
                                                ))}
                                            </span>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    </>
                )}
                {step === 5 && variant === "task-first" && (
                    <div className="mx-auto mt-12 grid w-full max-w-[1080px] gap-8 md:grid-cols-2">
                        <div>
                            <h1 className="mb-1 text-[22px] font-semibold">{title}</h1>
                            <p className="mb-4 text-colorTextSecondary">
                                Pick a task and see what you'll get. We'll build the agent for it.
                            </p>
                            <div className="flex flex-col gap-2">
                                {templates.map((template, index) => (
                                    <button
                                        type="button"
                                        key={template.key}
                                        aria-pressed={templateKey === template.key}
                                        className={choiceClass(templateKey === template.key)}
                                        onClick={() => {
                                            setTemplateKey(template.key)
                                            setTask("")
                                            onTemplate?.(index)
                                        }}
                                    >
                                        <span className="flex items-center gap-2">
                                            <strong>
                                                {taskTitles[template.name] ??
                                                    template.example?.prompt ??
                                                    template.name}
                                            </strong>
                                            {template.logoSlugs?.map((slug) => (
                                                <Image
                                                    key={slug}
                                                    src={`https://logos.composio.dev/api/${slug}`}
                                                    alt={slug}
                                                    width={14}
                                                    height={14}
                                                    unoptimized
                                                />
                                            ))}
                                            {index === 0 && (
                                                <span className="rounded bg-colorInfoBg px-1.5 py-0.5 text-[11px] text-colorInfo">
                                                    Recommended
                                                </span>
                                            )}
                                            <Radio active={templateKey === template.key} />
                                        </span>
                                        <span className="mt-1 block text-xs text-colorTextSecondary">
                                            {template.description}
                                        </span>
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    className={choiceClass(custom)}
                                    aria-pressed={custom}
                                    onClick={() => {
                                        setTemplateKey("__custom__")
                                        setTask("")
                                    }}
                                >
                                    <span className="flex items-center gap-2">
                                        <strong>Something else</strong>
                                        <Radio active={custom} />
                                    </span>
                                    <span className="mt-1 block text-xs text-colorTextSecondary">
                                        Describe it in your own words.
                                    </span>
                                </button>
                            </div>
                            {custom && (
                                <label className="mt-4 flex flex-col gap-2">
                                    What would you like it to do?
                                    <Input.TextArea
                                        rows={4}
                                        value={task}
                                        onChange={(event) => setTask(event.target.value)}
                                        maxLength={10000}
                                    />
                                </label>
                            )}
                        </div>
                        <aside className="border-0 md:border-l md:border-solid md:border-colorBorderSecondary md:pl-8">
                            <p className="mb-4 flex items-center gap-2 text-sm text-colorTextSecondary">
                                <Robot size={16} /> Agent we'll create
                            </p>
                            <div className="flex items-center gap-3">
                                <span
                                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${selected ? "bg-colorText text-colorBgContainer" : "bg-colorFillTertiary text-colorTextSecondary"}`}
                                >
                                    <Robot size={22} weight="fill" />
                                </span>
                                <span>
                                    <h2 className="text-lg font-semibold leading-tight">
                                        {selected?.name ?? "—"}
                                    </h2>
                                    <span className="text-sm text-colorTextSecondary">
                                        {selected?.description ?? "Pick a task on the left"}
                                    </span>
                                </span>
                            </div>
                            {!selected && !custom && (
                                <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-solid border-colorBorderSecondary px-6 py-10 text-center text-sm text-colorTextSecondary">
                                    <Sparkle size={18} />
                                    Select a task to preview the agent and an example run.
                                </div>
                            )}
                            {selected?.example && (
                                <div className="mt-6 rounded-xl border border-solid border-colorBorderSecondary p-4">
                                    <h3 className="text-sm font-semibold">Example run</h3>
                                    <p className="text-xs text-colorTextSecondary">
                                        Illustration only. Your agent hasn't run yet.
                                    </p>
                                    <p className="mt-4 rounded-lg bg-colorFillQuaternary p-3 text-sm">
                                        {selected.example.prompt}
                                    </p>
                                    <ol className="my-4 space-y-2 text-sm">
                                        {selected.example.steps.map((text) => (
                                            <li key={text} className="flex gap-2">
                                                <Check className="shrink-0 text-colorSuccess" />
                                                {text}
                                            </li>
                                        ))}
                                    </ol>
                                    <p className="text-sm">{selected.example.reply}</p>
                                </div>
                            )}
                            <div className="mt-6 flex justify-end">{createButton}</div>
                        </aside>
                    </div>
                )}
                <footer
                    className={`mt-10 flex items-center gap-4 border-0 ${step === 5 ? "justify-center" : "justify-between"}`}
                >
                    <Button
                        type="text"
                        icon={<ArrowLeft />}
                        onClick={() => move(step - 1)}
                        disabled={step === 1 || committing}
                    >
                        Back
                    </Button>
                    {step < 5 && (
                        <Button
                            type="primary"
                            size="large"
                            icon={<ArrowRight />}
                            iconPlacement="end"
                            disabled={!nextEnabled}
                            onClick={() => move(step + 1)}
                        >
                            {step === 3 ? modelNextLabel : "Next"}
                        </Button>
                    )}
                </footer>
            </div>
        </main>
    )
}
