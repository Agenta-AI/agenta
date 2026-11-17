import {EnhancedButton, RunButton} from "@agenta/ui/components/presentational"
import {Button as ShadButton, LoadingButton} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const BRow = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

const meta = {
    title: "@agenta/ui/Primitives/Forms/Button",
    component: ShadButton,
    subcomponents: {LoadingButton},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` cva Button with `variant` and `size` props, plus `LoadingButton` for async actions. See the subcomponent table below for the `LoadingButton` props.\n\n**Used in:** 43 files, mostly through the facades (`EnhancedButton`, `CopyButton`, `RunButton`, `CollapseToggleButton`, `DropdownButton`, `ScrollToTopButton`). Direct call-sites include the playground controls bar and execution rows (`@agenta/playground-ui`), the chat message list and attachment buttons, the Lexical editor toolbar, the virtualized table toolbar and filters, and the drill-in controls. `LoadingButton` is narrower — 5 places, all modal and table footers.",
            },
        },
    },
    args: {children: "Button", variant: "outline", size: "default"},
    argTypes: {
        variant: {
            control: "select",
            options: [
                "default",
                "outline",
                "dashed",
                "secondary",
                "ghost",
                "destructive",
                "destructive-outline",
                "link",
            ],
        },
        size: {
            control: "select",
            options: ["xs", "sm", "default", "lg", "icon-xs", "icon-sm", "icon", "icon-lg"],
        },
        disabled: {control: "boolean"},
    },
} satisfies Meta<typeof ShadButton>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Primary: Story = {args: {variant: "default", children: "Primary"}}
export const Ghost: Story = {args: {variant: "ghost", children: "Ghost"}}
export const Small: Story = {args: {size: "sm", children: "Small"}}
export const IconCircle: Story = {
    args: {size: "icon", className: "rounded-control-round", children: <Plus />},
}
export const Destructive: Story = {args: {variant: "destructive", children: "Destructive"}}

export const Variants: Story = {
    render: () => (
        <div className="flex flex-col max-w-[720px]">
            <BRow label="ghost">
                <ShadButton variant="ghost">Text</ShadButton>
            </BRow>
            <BRow label="default">
                <ShadButton variant="default">Primary</ShadButton>
            </BRow>
            <BRow label="outline">
                <ShadButton variant="outline">Default</ShadButton>
            </BRow>
            <BRow label="dashed">
                <ShadButton variant="dashed">Dashed</ShadButton>
            </BRow>
            <BRow label="link">
                <ShadButton variant="link">Link</ShadButton>
            </BRow>
            <BRow label="destructive-outline">
                <ShadButton variant="destructive-outline">Danger</ShadButton>
            </BRow>
            <BRow label="destructive (Nova tint)">
                <ShadButton variant="destructive">Del</ShadButton>
            </BRow>
            <BRow label="sm">
                <ShadButton variant="outline" size="sm">
                    Small
                </ShadButton>
            </BRow>
            <BRow label="lg">
                <ShadButton variant="outline" size="lg">
                    Large
                </ShadButton>
            </BRow>
            <BRow label="icon">
                <ShadButton variant="outline" size="icon" className="rounded-control-round">
                    <Plus />
                </ShadButton>
            </BRow>
            <BRow label="loading">
                <LoadingButton variant="outline" loading>
                    Load
                </LoadingButton>
            </BRow>
            <BRow label="disabled">
                <ShadButton variant="outline" disabled>
                    Disabled
                </ShadButton>
            </BRow>
        </div>
    ),
}

const NOVA_VARIANTS = [
    "default",
    "outline",
    "dashed",
    "secondary",
    "ghost",
    "destructive",
    "destructive-outline",
    "link",
] as const
const NOVA_SIZES = ["xs", "sm", "default", "lg"] as const

// Every variant × size of the Nova-styled Button, with and without a leading icon.
export const NovaMatrix: Story = {
    render: () => (
        <div className="flex flex-col gap-3">
            {NOVA_VARIANTS.map((variant) => (
                <div key={variant} className="flex items-center gap-3">
                    <div className="w-36 text-xs text-colorTextSecondary">{variant}</div>
                    {NOVA_SIZES.map((size) => (
                        <ShadButton key={size} variant={variant} size={size}>
                            {size}
                        </ShadButton>
                    ))}
                    {NOVA_SIZES.map((size) => (
                        <ShadButton key={`${size}-icon`} variant={variant} size={size}>
                            <Plus data-icon="inline-start" />
                            {size}
                        </ShadButton>
                    ))}
                    {(["icon-xs", "icon-sm", "icon", "icon-lg"] as const).map((size) => (
                        <ShadButton key={size} variant={variant} size={size} aria-label="add">
                            <Plus />
                        </ShadButton>
                    ))}
                    <ShadButton variant={variant} disabled>
                        disabled
                    </ShadButton>
                    <LoadingButton variant={variant} loading>
                        loading
                    </LoadingButton>
                </div>
            ))}
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, which forces that pseudo-class on the control inside.
const StateRow = ({
    label,
    pseudo,
    children,
}: {
    label: string
    pseudo: string
    children: React.ReactNode
}) => (
    <div className="grid grid-cols-[14rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} flex items-center gap-2`}>{children}</div>
    </div>
)

const STATES: {
    label: string
    pseudo: string
    variant: React.ComponentProps<typeof ShadButton>["variant"]
    text: string
}[] = [
    {label: "primary · hover", pseudo: "pseudo-hover-all", variant: "default", text: "Primary"},
    {
        label: "primary · focus-visible",
        pseudo: "pseudo-focus-visible-all",
        variant: "default",
        text: "Primary",
    },
    {label: "outline · hover", pseudo: "pseudo-hover-all", variant: "outline", text: "Default"},
    {
        label: "outline · focus-visible",
        pseudo: "pseudo-focus-visible-all",
        variant: "outline",
        text: "Default",
    },
    {label: "ghost · hover", pseudo: "pseudo-hover-all", variant: "ghost", text: "Text"},
    {label: "destructive · hover", pseudo: "pseudo-hover-all", variant: "destructive", text: "Del"},
    {
        label: "primary · active (pressed)",
        pseudo: "pseudo-active-all",
        variant: "default",
        text: "Primary",
    },
    {
        label: "outline · active (pressed)",
        pseudo: "pseudo-active-all",
        variant: "outline",
        text: "Default",
    },
    {
        label: "ghost · active (pressed)",
        pseudo: "pseudo-active-all",
        variant: "ghost",
        text: "Text",
    },
    {label: "link · active (pressed)", pseudo: "pseudo-active-all", variant: "link", text: "Link"},
    {
        label: "dashed · active (pressed)",
        pseudo: "pseudo-active-all",
        variant: "dashed",
        text: "Dashed",
    },
    {
        label: "destructive · active (pressed)",
        pseudo: "pseudo-active-all",
        variant: "destructive",
        text: "Del",
    },
    {
        label: "destructive-outline · active (pressed)",
        pseudo: "pseudo-active-all",
        variant: "destructive-outline",
        text: "Del",
    },
    {label: "link · hover", pseudo: "pseudo-hover-all", variant: "link", text: "Link"},
]

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            {STATES.map((st) => (
                <StateRow key={st.label} label={st.label} pseudo={st.pseudo}>
                    <ShadButton variant={st.variant}>{st.text}</ShadButton>
                </StateRow>
            ))}
        </div>
    ),
}

export const AbsorbedPresets: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <EnhancedButton tooltipProps={{title: "I am a tooltip"}}>
                    EnhancedButton
                </EnhancedButton>
                <ShadButton variant="outline">
                    <Plus />
                    Add item
                </ShadButton>
                <RunButton />
                <RunButton mode="cancel" />
                <RunButton mode="runAll" variant="default" />
            </div>
            <div className="text-xs text-colorTextSecondary">
                → collapse into: Button with a `tooltip` prop, and Button with an `icon`.
            </div>
        </div>
    ),
}
