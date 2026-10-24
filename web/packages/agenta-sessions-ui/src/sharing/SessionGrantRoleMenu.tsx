import type {SessionRole} from "@agenta/entities/sharing"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Spinner,
} from "@agenta/ui/ui"
import {CaretDownIcon, CheckIcon} from "@phosphor-icons/react"

import {sessionRoleCopy, sessionSharingCopy} from "./copy"

/** The fixed role column, so "Owner" and every menu line up. */
export const ROLE_COLUMN_CLASS = "flex w-[112px] shrink-0 justify-end"

const ROLES: SessionRole[] = ["viewer", "participant"]

export interface SessionGrantRoleMenuProps {
    role: SessionRole
    personName: string
    saving?: boolean
    /** False when the person's project role cannot send: "Can send" cannot take effect. */
    canSend?: boolean
    onChangeRole: (role: SessionRole) => void
    onRemove: () => void
}

export const SessionGrantRoleMenu = ({
    role,
    personName,
    saving = false,
    canSend = true,
    onChangeRole,
    onRemove,
}: SessionGrantRoleMenuProps) => {
    // What the grant does, not what is stored: "Can send" for a role that cannot send is
    // "Can view".
    const shown: SessionRole = canSend ? role : "viewer"
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={saving}>
                <button
                    type="button"
                    aria-label={`${personName}: ${sessionRoleCopy[shown].label}`}
                    className="flex cursor-pointer items-center gap-1 rounded-control-sm border-0 bg-transparent px-1.5 py-1 text-sm text-foreground [font-family:inherit] hover:bg-accent"
                >
                    {saving ? <Spinner size="small" /> : null}
                    {sessionRoleCopy[shown].label}
                    <CaretDownIcon size={12} aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[300px]">
                {ROLES.map((option) => (
                    <DropdownMenuItem
                        key={option}
                        disabled={option === "participant" && !canSend}
                        onSelect={() => {
                            if (option !== role) onChangeRole(option)
                        }}
                        className="items-start"
                    >
                        <span className="mt-0.5 flex size-3.5 shrink-0">
                            {option === role ? <CheckIcon size={14} aria-hidden /> : null}
                        </span>
                        <span className="flex flex-col">
                            <span>{sessionRoleCopy[option].label}</span>
                            <span className="text-xs text-muted-foreground">
                                {option === "participant" && !canSend
                                    ? sessionSharingCopy.roleCannotSend
                                    : sessionRoleCopy[option].description}
                            </span>
                        </span>
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                    <span className="flex size-3.5 shrink-0" />
                    {sessionSharingCopy.removeAccess}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
