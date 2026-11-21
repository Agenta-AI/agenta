import {User, Robot} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Direct source import: avatar.tsx is new and not yet re-exported from the `@agenta/ui/ui`
// barrel (that wiring is a separate step). Storybook transpiles the package source, so the
// relative path renders the real component.
import {AvatarBox} from "../../packages/agenta-ui/src/components/ui/avatar"

const meta = {
    title: "@agenta/ui/Primitives/Display/Avatar",
    component: AvatarBox,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A user or entity avatar (`AvatarBox`) with image, initials or icon fallback, in circle or square shape.\n\n**Used in:** `Avatar`/`AvatarImage`/`AvatarFallback` have zero call-sites. Only `AvatarBox` ships, and only through `InitialsAvatar` — sidebar org/project pickers, workspace member rows, annotation assignment cells and the shared user author label (7 places).",
            },
        },
    },
} satisfies Meta<typeof AvatarBox>

export default meta
type Story = StoryObj<typeof meta>

// A stable 1x1 data-URI keeps the image deterministic (no network).
const IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='#4096ff'/><circle cx='20' cy='15' r='7' fill='#fff'/><rect x='8' y='26' width='24' height='14' rx='7' fill='#fff'/></svg>`,
    )

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            {/* initials fallback × size × shape */}
            <Row label="initials — small, circle">
                <AvatarBox size="small">AE</AvatarBox>
            </Row>
            <Row label="initials — default, circle">
                <AvatarBox>AE</AvatarBox>
            </Row>
            <Row label="initials — large, circle">
                <AvatarBox size="large">AE</AvatarBox>
            </Row>
            <Row label="initials — small, square">
                <AvatarBox size="small" shape="square">
                    AE
                </AvatarBox>
            </Row>
            <Row label="initials — default, square">
                <AvatarBox shape="square">AE</AvatarBox>
            </Row>
            <Row label="initials — large, square">
                <AvatarBox size="large" shape="square">
                    AE
                </AvatarBox>
            </Row>
            {/* icon fallback */}
            <Row label="icon — small, circle">
                <AvatarBox size="small" icon={<User size={16} />} alt="user" />
            </Row>
            <Row label="icon — default, circle">
                <AvatarBox icon={<Robot size={18} />} alt="robot" />
            </Row>
            <Row label="icon — large, square">
                <AvatarBox size="large" shape="square" icon={<User size={20} />} alt="user" />
            </Row>
            {/* image */}
            <Row label="image — default, circle">
                <AvatarBox src={IMG} alt="avatar" />
            </Row>
            <Row label="image — large, square">
                <AvatarBox size="large" shape="square" src={IMG} alt="avatar" />
            </Row>
            {/* numeric size (InitialsAvatar/AssignmentsCell pass raw px) */}
            <Row label="initials — numeric 18, square">
                <AvatarBox size={18} shape="square">
                    AE
                </AvatarBox>
            </Row>
        </div>
    ),
}
