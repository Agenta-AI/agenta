import {User, Robot} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Avatar as AntAvatar} from "antd"

// Direct source import: avatar.tsx is new and not yet re-exported from the `@agenta/ui/ui`
// barrel (that wiring is a separate step). Storybook transpiles the package source, so the
// relative path renders the real component for the parity gate.
import {AvatarBox} from "../../packages/agenta-ui/src/components/ui/avatar"

// Phase-0 parity story: the REAL antd Avatar behind the app theme, side by side with the
// @agenta/ui re-skin. antd size (small/default/large) + shape (circle/square) + image /
// initials / icon fallback map 1:1.
const meta = {
    title: "@agenta/ui/Primitives/Display/Avatar",
    component: AntAvatar,
    subcomponents: {"Avatar (@agenta/ui)": AvatarBox},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "antd `Avatar` (interactive reference) shown beside the `@agenta/ui` Avatar (`AvatarBox`) that replaces it. See the subcomponent table below for the agenta props.\n\n**Used in:** `Avatar`/`AvatarImage`/`AvatarFallback` have zero call-sites. Only `AvatarBox` ships, and only through `InitialsAvatar` — sidebar org/project pickers, workspace member rows, annotation assignment cells and the shared user author label (7 places).",
            },
        },
    },
} satisfies Meta<typeof AntAvatar>

export default meta
type Story = StoryObj<typeof meta>

// A stable 1x1 data-URI keeps the VRT deterministic (no network image flake).
const IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='#4096ff'/><circle cx='20' cy='15' r='7' fill='#fff'/><rect x='8' y='26' width='24' height='14' rx='7' fill='#fff'/></svg>`,
    )

// `.grid` Row: [label | antd cell | agenta cell] — the parity gate pairs the Avatar in each.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="flex items-center">{a}</div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="flex items-center">{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            {/* initials fallback × size × shape */}
            <Row
                label="initials — small, circle"
                a={<AntAvatar size="small">AE</AntAvatar>}
                s={<AvatarBox size="small">AE</AvatarBox>}
            />
            <Row
                label="initials — default, circle"
                a={<AntAvatar>AE</AntAvatar>}
                s={<AvatarBox>AE</AvatarBox>}
            />
            <Row
                label="initials — large, circle"
                a={<AntAvatar size="large">AE</AntAvatar>}
                s={<AvatarBox size="large">AE</AvatarBox>}
            />
            <Row
                label="initials — small, square"
                a={
                    <AntAvatar size="small" shape="square">
                        AE
                    </AntAvatar>
                }
                s={
                    <AvatarBox size="small" shape="square">
                        AE
                    </AvatarBox>
                }
            />
            <Row
                label="initials — default, square"
                a={<AntAvatar shape="square">AE</AntAvatar>}
                s={<AvatarBox shape="square">AE</AvatarBox>}
            />
            <Row
                label="initials — large, square"
                a={
                    <AntAvatar size="large" shape="square">
                        AE
                    </AntAvatar>
                }
                s={
                    <AvatarBox size="large" shape="square">
                        AE
                    </AvatarBox>
                }
            />
            {/* icon fallback */}
            <Row
                label="icon — small, circle"
                a={<AntAvatar size="small" icon={<User size={16} />} />}
                s={<AvatarBox size="small" icon={<User size={16} />} alt="user" />}
            />
            <Row
                label="icon — default, circle"
                a={<AntAvatar icon={<Robot size={18} />} />}
                s={<AvatarBox icon={<Robot size={18} />} alt="robot" />}
            />
            <Row
                label="icon — large, square"
                a={<AntAvatar size="large" shape="square" icon={<User size={20} />} />}
                s={<AvatarBox size="large" shape="square" icon={<User size={20} />} alt="user" />}
            />
            {/* image */}
            <Row
                label="image — default, circle"
                a={<AntAvatar src={IMG} alt="avatar" />}
                s={<AvatarBox src={IMG} alt="avatar" />}
            />
            <Row
                label="image — large, square"
                a={<AntAvatar size="large" shape="square" src={IMG} alt="avatar" />}
                s={<AvatarBox size="large" shape="square" src={IMG} alt="avatar" />}
            />
            {/* numeric size (InitialsAvatar/AssignmentsCell pass raw px) */}
            <Row
                label="initials — numeric 18, square"
                a={
                    <AntAvatar size={18} shape="square">
                        AE
                    </AntAvatar>
                }
                s={
                    <AvatarBox size={18} shape="square">
                        AE
                    </AvatarBox>
                }
            />
        </div>
    ),
}
