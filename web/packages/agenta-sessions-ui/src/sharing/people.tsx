import type {ProjectMemberProfile} from "@agenta/entities/sharing"
import {Avatar, AvatarFallback} from "@agenta/ui/ui"

/** The fields a person row shows; a member profile fits. */
export type SharingPerson = Pick<ProjectMemberProfile, "user_id" | "email" | "name"> & {
    /** False when the person's project role cannot send in a session (from the picker). */
    can_run_sessions?: boolean | null
}

export const personName = (person: SharingPerson | null | undefined): string =>
    person?.name?.trim() || person?.email || ""

const initials = (person: SharingPerson): string => {
    const words = personName(person)
        .split(/[\s@._-]+/)
        .filter(Boolean)
    return words
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .join("")
}

export const PersonAvatar = ({person}: {person: SharingPerson}) => (
    <Avatar size="small" aria-hidden className="shrink-0">
        <AvatarFallback className="bg-muted text-[11px] font-medium text-muted-foreground">
            {initials(person)}
        </AvatarFallback>
    </Avatar>
)
