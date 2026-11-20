import {useEffect, useState, type ReactNode} from "react"

import {
    BottomSheetMenu,
    PhonePrimaryAction,
    PhoneScreenHeader,
    SIDEBAR_SHEET_ROW_CLASS,
    SidebarSheet,
} from "@agenta/ui/phone"
import {
    defineView,
    PhoneViewChrome,
    useViewForm,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewProps,
} from "@agenta/ui/view-stack"
import {
    CaretLeft,
    CaretRight,
    ChartBar,
    ClockCounterClockwise,
    Lightning,
    Plus,
    Sparkle,
    SlidersHorizontal,
    WifiHigh,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {
    AGENT_NAME,
    AGENTS_MD,
    PHONE_ADD_AUTOMATION,
    PHONE_INTEGRATIONS,
    PHONE_SIDEBAR_ROWS,
} from "../../../fixtures/builderLayout/phone"

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

const InstructionsBody = ({readOnly}: ViewProps<{file: string}>) => {
    const [text, setText] = useState(AGENTS_MD)
    useViewTitle("AGENTS.md")
    useViewForm({
        dirty: text !== AGENTS_MD,
        valid: true,
        save: async () => true,
        leaveDescription: "Save your changes to this agent draft, or discard them?",
    })
    return readOnly ? (
        <p className="m-0 whitespace-pre-wrap px-4 py-3 text-[15px] leading-[22px]">{text}</p>
    ) : (
        <textarea
            aria-label="AGENTS.md"
            className="m-4 min-h-0 flex-1 rounded-lg border border-solid border-border p-3 text-[15px]"
            value={text}
            onChange={(event) => setText(event.target.value)}
        />
    )
}

const instructionsView = defineView<{file: string}>({
    id: "story.phone.instructions",
    apply: "on_save",
    readOnlyOnPhone: true,
    Component: InstructionsBody,
})
const editableInstructionsView = defineView<{file: string}>({
    id: "story.phone.instructionsEditable",
    apply: "on_save",
    Component: InstructionsBody,
})

const OpenOnMount = ({readOnly}: {readOnly: boolean}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(
            readOnly ? instructionsView : editableInstructionsView,
            {file: "AGENTS.md"},
            {kind: "agent_draft", revisionId: "rev"},
        )
        // Open once on mount, like a row tap.
    }, [])
    return null
}

/** The phone chrome of the view stack around a view. */
const PhoneView = ({readOnly = false}: {readOnly?: boolean}) => (
    <Phone>
        <ViewStackHost chrome={PhoneViewChrome} rootTitle="Configuration" phone>
            <OpenOnMount readOnly={readOnly} />
        </ViewStackHost>
    </Phone>
)

/** A list screen with its one primary action at the bottom (frame M08). */
const ListScreen = () => (
    <Phone>
        <PhoneScreenHeader title="Integrations" backTitle="Configuration" onBack={() => {}} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2">
            {PHONE_INTEGRATIONS.map((integration) => (
                <button
                    key={integration.name}
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-transparent py-1.5 pl-4 pr-4 text-left font-[inherit]"
                >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-colorFillTertiary text-sm font-semibold">
                        Z
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px]">{integration.name}</span>
                        <span className="truncate text-xs text-colorTextSecondary">
                            {integration.line}
                        </span>
                    </span>
                    <CaretRight size={14} className="shrink-0 text-colorTextTertiary" />
                </button>
            ))}
            <PhonePrimaryAction icon={<Plus size={14} />} onClick={() => {}}>
                Add integration
            </PhonePrimaryAction>
        </div>
    </Phone>
)

/** "Add automation" as a bottom sheet (frame M11). */
const SheetMenu = () => {
    const [open, setOpen] = useState(true)
    const icons = {
        app: <Lightning />,
        schedule: <ClockCounterClockwise />,
        ai: <Sparkle />,
    }
    return (
        <Phone>
            <PhoneScreenHeader title="Configuration" backTitle="Session" onBack={() => {}} />
            <BottomSheetMenu
                open={open}
                onOpenChange={setOpen}
                title="Add automation"
                items={PHONE_ADD_AUTOMATION.map((entry) => ({
                    ...entry,
                    icon: icons[entry.key],
                    onSelect: () => {},
                }))}
            />
        </Phone>
    )
}

/** The sidebar sheet with agent rows (frame M02, the rows only; task 49.3 fills it). */
const Sidebar = () => {
    const [open, setOpen] = useState(true)
    const icons = [<SlidersHorizontal key="c" />, <WifiHigh key="ch" />, <ChartBar key="a" />]
    return (
        <Phone>
            <SidebarSheet
                open={open}
                onOpenChange={setOpen}
                title={AGENT_NAME}
                leading={
                    <button
                        type="button"
                        className="flex h-11 items-center gap-1 rounded-lg border-0 bg-transparent px-2 font-[inherit] text-[15px] text-colorTextSecondary"
                    >
                        <CaretLeft size={14} />
                        Back
                    </button>
                }
            >
                <nav className="flex flex-col pt-2">
                    {PHONE_SIDEBAR_ROWS.map((row, index) => (
                        <a key={row} href="#" className={SIDEBAR_SHEET_ROW_CLASS}>
                            <span className="flex shrink-0 text-colorTextSecondary [&_svg]:size-5">
                                {icons[index]}
                            </span>
                            <span>{row}</span>
                        </a>
                    ))}
                </nav>
            </SidebarSheet>
        </Phone>
    )
}

const meta = {
    title: "BuilderLayout/phone/Phone kit",
    component: PhoneView,
    parameters: {layout: "fullscreen"},
} satisfies Meta<typeof PhoneView>

export default meta
type Story = StoryObj<typeof meta>

export const ViewEditable: Story = {globals: {theme: "light"}}
export const ViewEditableDark: Story = {globals: {theme: "dark"}}
export const ViewReadOnly: Story = {args: {readOnly: true}, globals: {theme: "light"}}
export const PrimaryAction: Story = {render: () => <ListScreen />, globals: {theme: "light"}}
export const PrimaryActionDark: Story = {render: () => <ListScreen />, globals: {theme: "dark"}}
export const SheetMenuOpen: Story = {render: () => <SheetMenu />, globals: {theme: "light"}}
export const SidebarSheetOpen: Story = {render: () => <Sidebar />, globals: {theme: "light"}}
