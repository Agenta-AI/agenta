import type {ProjectMemberProfile} from "@agenta/entities/sharing"
import {Avatar, AvatarFallback, cn} from "@agenta/ui/ui"

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

/** `default` (28px) in the people list's two-line rows; `small` (24px) in chips and pickers. */
export const PersonAvatar = ({
    person,
    size = "small",
}: {
    person: SharingPerson
    size?: "small" | "default"
}) => (
    <Avatar size={size} aria-hidden className="shrink-0">
        <AvatarFallback
            className={cn(
                "bg-muted font-medium text-muted-foreground",
                size === "small" ? "text-caption" : "text-label",
            )}
        >
            {initials(person)}
        </AvatarFallback>
    </Avatar>
)
