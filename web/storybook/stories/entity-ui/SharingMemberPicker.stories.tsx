import {useState} from "react"

import type {ProjectMemberProfile} from "@agenta/entities/sharing"
import {MemberPicker, type SharingPerson} from "@agenta/entity-ui/sharing"
import type {Meta, StoryObj} from "@storybook/nextjs"

const MEMBERS: ProjectMemberProfile[] = [
    {user_id: "u-alice", email: "alice@acme.com", name: "Alice Martin"},
    {user_id: "u-bob", email: "bob@acme.com", name: "Bob Lee"},
    {user_id: "u-carol", email: "carol@acme.com", name: "Carol Ng"},
    {user_id: "u-camila", email: "camila@acme.com", name: "Camila Ortiz"},
    {user_id: "u-carlos", email: "carlos@acme.com", name: "Carlos Ruiz"},
]

interface PickerStoryProps {
    mode?: "multiple" | "single"
    initialSearch?: string
    initialSelected?: SharingPerson[]
    accessUserIds?: string[]
    invalidUserIds?: string[]
    loading?: boolean
    error?: boolean
}

function Picker({
    mode = "multiple",
    initialSearch = "",
    initialSelected = [],
    accessUserIds = ["u-carlos"],
    invalidUserIds = [],
    loading,
    error,
}: PickerStoryProps) {
    const [search, setSearch] = useState(initialSearch)
    const [selected, setSelected] = useState<SharingPerson[]>(initialSelected)
    const query = search.trim().toLowerCase()
    const members = MEMBERS.filter(
        (m) =>
            !query ||
            m.email.toLowerCase().startsWith(query) ||
            (m.name ?? "").toLowerCase().startsWith(query),
    )
    return (
        <div className="w-[480px] max-w-full">
            <MemberPicker
                mode={mode}
                projectName="Acme support"
                members={members}
                search={search}
                onSearch={setSearch}
                selected={selected}
                onPick={(member) =>
                    setSelected((list) => (mode === "single" ? [member] : [...list, member]))
                }
                onRemove={(userId) =>
                    setSelected((list) => list.filter((p) => p.user_id !== userId))
                }
                excludeUserIds={["u-alice"]}
                accessUserIds={accessUserIds}
                invalidUserIds={invalidUserIds}
                loading={loading}
                error={error}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/Sharing/MemberPicker",
    component: Picker,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Multi-person picker over project members only. The owner is not listed; people with access show "Has access" and cannot be picked. Focus the field to open the list.',
            },
        },
    },
} satisfies Meta<typeof Picker>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const WithChips: Story = {args: {initialSelected: [MEMBERS[1]]}}
export const NoMatch: Story = {args: {initialSearch: "zed"}}
export const Loading: Story = {args: {loading: true}}
export const LoadError: Story = {args: {error: true}}
export const InvalidGrantee: Story = {
    args: {initialSelected: [MEMBERS[1], MEMBERS[2]], invalidUserIds: ["u-bob"]},
}
export const SingleMode: Story = {args: {mode: "single", accessUserIds: []}}
