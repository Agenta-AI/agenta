import type {WorkspaceMember} from "@agenta/entities/organization"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SkeletonBlock,
} from "@agenta/ui/ui"

/** "admin" reads as "Admin" in the table and in the picker. */
export const memberRoleLabel = (role: string) =>
    role ? role.charAt(0).toUpperCase() + role.slice(1) : "—"

/** The role a member holds. The API keeps one role per member, so the first one is it. */
export const memberRole = (member: WorkspaceMember) => member.roles?.[0]?.role_name ?? ""

/**
 * A member's role: a label, or a picker for someone who may change it.
 *
 * Only a joined member gets a picker: an invitation has no membership for the role route to
 * change. The owner's row is a label whatever the reader may do, because ownership moves by
 * transfer and the API refuses to set or unset it here.
 */
export const MemberRoleCell = ({
    member,
    isOwner,
    offeredRoles,
    canChange,
    pending = false,
    onChange,
}: {
    member: WorkspaceMember
    isOwner: boolean
    /** The roles this organization may set, which never includes the owner role. */
    offeredRoles: string[]
    canChange: boolean
    /** This member's change is in flight: the picker holds until it lands. */
    pending?: boolean
    onChange: (role: string) => void
}) => {
    const role = memberRole(member)
    const joined = member.user.status === "member"

    if (pending) return <SkeletonBlock active className="h-6 w-24 rounded-control-sm" />
    if (!canChange || isOwner || !joined || offeredRoles.length === 0) {
        return <span>{memberRoleLabel(role)}</span>
    }

    // A stored role the plan no longer offers (an editor after a move to Pro) matches no item, so
    // it shows as the trigger's text until the reader picks one of the offered roles.
    const offered = offeredRoles.includes(role)
    return (
        <Select value={offered ? role : undefined} onValueChange={onChange}>
            <SelectTrigger size="sm" className="w-full" aria-label="Role">
                <SelectValue placeholder={memberRoleLabel(role)} />
            </SelectTrigger>
            <SelectContent>
                {offeredRoles.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                        {memberRoleLabel(entry)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
