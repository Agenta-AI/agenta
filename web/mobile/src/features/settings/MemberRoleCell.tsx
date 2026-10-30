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
 * The owner's row is a label whatever the reader may do, because ownership moves by transfer
 * and the API refuses to set or unset it here.
 */
export const MemberRoleCell = ({
    member,
    isOwner,
    roles,
    canChange,
    pending = false,
    onChange,
}: {
    member: WorkspaceMember
    isOwner: boolean
    /** The roles this organization offers, owner excluded. */
    roles: string[]
    canChange: boolean
    /** This member's change is in flight: the picker holds until it lands. */
    pending?: boolean
    onChange: (role: string) => void
}) => {
    const role = memberRole(member)

    if (pending) return <SkeletonBlock active className="h-6 w-24 rounded-control-sm" />
    if (!canChange || isOwner || roles.length === 0) {
        return <span>{memberRoleLabel(role)}</span>
    }

    return (
        <Select value={role || undefined} onValueChange={onChange}>
            <SelectTrigger size="sm" className="w-full" aria-label="Role">
                <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
                {roles.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                        {memberRoleLabel(entry)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
