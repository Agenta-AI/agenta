import {useEffect, useRef, useState} from "react"

import type {ProjectMemberProfile} from "@agenta/entities/sharing"
import {useT} from "@agenta/i18n"
import sharingCatalog from "@agenta/i18n/catalogs/entityUi.sharing"
import {
    MemberPicker,
    personName,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/sessions-ui/sharing"
import {Alert, LoadingButton} from "@agenta/ui/ui"

import {agentSharingCopy as copy} from "./copy"

export interface AgentTransferFormProps {
    isPrivate: boolean
    ownerUserId?: string | null
    members: readonly ProjectMemberProfile[]
    membersSearch: string
    onMembersSearch: (text: string) => void
    membersLoading?: boolean
    membersError?: boolean
    onTransfer: (userId: string) => Promise<SharingWriteResult>
    /** Called after a transfer landed, with the new owner. */
    onTransferred?: (owner: SharingPerson) => void
    /** Called with a result that is neither ok nor `invalid_grantee`. */
    onFailed?: (result: SharingWriteResult) => void
}

/** The transfer step in place under the owner row: the Share dialog's member picker, then confirm. */
export const AgentTransferForm = ({
    isPrivate,
    ownerUserId,
    members,
    membersSearch,
    onMembersSearch,
    membersLoading,
    membersError,
    onTransfer,
    onTransferred,
    onFailed,
}: AgentTransferFormProps) => {
    // The texts come from `copy`; this draws the form again when the language's text loads.
    useT(sharingCatalog)
    const [target, setTarget] = useState<SharingPerson | null>(null)
    const [invalid, setInvalid] = useState(false)
    const [saving, setSaving] = useState(false)
    const name = personName(target)
    const rootRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        rootRef.current?.querySelector("input")?.focus()
    }, [])

    const transfer = async () => {
        if (!target) return
        setSaving(true)
        let result: SharingWriteResult
        try {
            result = await onTransfer(target.user_id)
        } catch {
            result = "failed"
        }
        setSaving(false)
        if (result === "ok") onTransferred?.(target)
        else if (result === "invalid_grantee") setInvalid(true)
        else onFailed?.(result)
    }

    return (
        <div ref={rootRef} className="ag-view-enter flex flex-col gap-2">
            {/* The Share dialog's invite row: the picker, then its one action. */}
            <div className="flex items-start gap-2">
                <MemberPicker
                    mode="single"
                    members={members}
                    search={membersSearch}
                    onSearch={onMembersSearch}
                    selected={target ? [target] : []}
                    onPick={(member) => {
                        setTarget(member)
                        setInvalid(false)
                    }}
                    onRemove={() => {
                        setTarget(null)
                        setInvalid(false)
                    }}
                    excludeUserIds={ownerUserId ? [ownerUserId] : []}
                    invalidUserIds={invalid && target ? [target.user_id] : []}
                    loading={membersLoading}
                    error={membersError}
                    disabled={saving}
                />
                <LoadingButton
                    variant={isPrivate ? "destructive" : "default"}
                    loading={saving}
                    disabled={!target || invalid}
                    onClick={() => void transfer()}
                >
                    {copy.transferShort}
                </LoadingButton>
            </div>
            {invalid && target ? (
                <p className="m-0 text-meta text-destructive">{copy.transferInvalid(name)}</p>
            ) : null}
            {target ? (
                <Alert
                    type="warning"
                    showIcon
                    role="note"
                    message={
                        isPrivate ? copy.transferPrivateWarning(name) : copy.transferShared(name)
                    }
                    description={isPrivate ? copy.transferPrivateChats : undefined}
                />
            ) : null}
        </div>
    )
}
