import {useEffect, type ReactNode} from "react"

import {
    AgentTemplateSectionList,
    PhoneSectionsContext,
    usePhoneSectionScreen,
    type AgentTemplateSectionDescriptor,
} from "@agenta/entity-ui/drill-in"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {
    Compass,
    Cpu,
    FileText,
    Gear,
    Lock,
    Robot,
    ShieldCheck,
    WifiHigh,
    Wrench,
    ClockCounterClockwise,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {M07_SECTIONS, M07_VERSION_LABEL} from "../../../fixtures/builderLayout/agent-pages-phone"

const ICONS: Record<string, ReactNode> = {
    "model-harness": <Cpu size={16} />,
    instructions: <FileText size={16} />,
    tools: <Wrench size={16} />,
    subagents: <Robot size={16} />,
    mcp: <WifiHigh size={16} />,
    skills: <Compass size={16} />,
    secrets: <Lock size={16} />,
    permissions: <ShieldCheck size={16} />,
    advanced: <Gear size={16} />,
}

/** A 390 x 844 phone screen. */
const Phone = ({children}: {children: ReactNode}) => (
    <div
        data-testid="phone-screen"
        className="relative flex flex-col overflow-hidden border border-solid border-border bg-colorBgContainer"
        style={{width: 390, height: 844}}
    >
        {children}
    </div>
)

/** M07: the Configuration screen of a session on a phone, with a row per section. */
const Configuration = ({shownKey}: {shownKey?: string}) => {
    const sectionScreen = usePhoneSectionScreen(true)
    const show = sectionScreen.api?.show
    // A story that starts on a section screen opens it once, as a tap would.
    useEffect(() => {
        const preset = M07_SECTIONS.find((s) => s.key === shownKey)
        if (preset) show?.(preset.key, preset.title)
    }, [shownKey, show])
    const shown = sectionScreen.shown
    const sections: AgentTemplateSectionDescriptor[] = M07_SECTIONS.map((s) => ({
        ...s,
        icon: ICONS[s.key],
        content: <p className="m-0 text-sm text-colorTextSecondary">{s.title} rows</p>,
    }))
    return (
        <Phone>
            {shown ? (
                <PhoneScreenHeader
                    title={shown.title}
                    backTitle="Configuration"
                    onBack={sectionScreen.close}
                />
            ) : (
                <>
                    <PhoneScreenHeader
                        title="Configuration"
                        backTitle="Session"
                        onBack={() => undefined}
                    />
                    <div className="flex items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary pl-2 pr-1">
                        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1">
                            {["Agent", "Automations", "Access"].map((tab, index) => (
                                <button
                                    key={tab}
                                    type="button"
                                    role="tab"
                                    aria-selected={index === 0}
                                    className={
                                        index === 0
                                            ? "h-11 min-w-11 px-2 text-[15px] font-medium text-colorText shadow-[inset_0_-2px_0_currentColor]"
                                            : "h-11 min-w-11 px-2 text-[15px] text-colorTextSecondary"
                                    }
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            className="flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded border-0 bg-transparent px-2 text-[13px] text-colorTextSecondary"
                        >
                            <ClockCounterClockwise size={11} />
                            {M07_VERSION_LABEL}
                        </button>
                    </div>
                </>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
                <PhoneSectionsContext.Provider value={sectionScreen.api}>
                    <AgentTemplateSectionList sections={sections} />
                </PhoneSectionsContext.Provider>
            </div>
        </Phone>
    )
}

const meta: Meta = {
    title: "BuilderLayout/M07 Configuration on a phone",
    parameters: {layout: "fullscreen"},
}
export default meta

type Story = StoryObj

/** M07: the Agent tab rows with their current values and "Saved as v4" in the tab row. */
export const AgentTab: Story = {render: () => <Configuration />}

export const AgentTabDark: Story = {
    render: () => <Configuration />,
    globals: {theme: "dark"},
}

/** A section opened from its row: its own screen with "Back to Configuration". */
export const SectionScreen: Story = {render: () => <Configuration shownKey="skills" />}
