import {useState} from "react"

import type {ProjectMemberProfile} from "@agenta/entities/sharing"
import {
    MemberPicker,
    SharingSurface,
    personName,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/sessions-ui/sharing"
import {Alert, Button, LoadingButton} from "@agenta/ui/ui"

import {agentSharingCopy as copy} from "./copy"

export interface AgentTransferDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    agentName: string
    projectName: string
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

export const AgentTransferDialog = ({
    open,
    onOpenChange,
    agentName,
    projectName,
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
}: AgentTransferDialogProps) => {
    const [target, setTarget] = useState<SharingPerson | null>(null)
    const [invalid, setInvalid] = useState(false)
    const [saving, setSaving] = useState(false)
    const name = personName(target)

    const close = (next: boolean) => {
        if (saving) return
        if (!next) {
            setTarget(null)
            setInvalid(false)
        }
        onOpenChange(next)
    }

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
        if (result === "ok") {
            onTransferred?.(target)
            setTarget(null)
            onOpenChange(false)
        } else if (result === "invalid_grantee") setInvalid(true)
        else onFailed?.(result)
    }

    return (
        <SharingSurface
            open={open}
            onOpenChange={close}
            title={copy.transferTitle}
            description={agentName}
            footer={
                <>
                    <Button variant="outline" disabled={saving} onClick={() => close(false)}>
                        {copy.cancel}
                    </Button>
                    {target ? (
                        <LoadingButton
                            variant={isPrivate ? "destructive" : "default"}
                            loading={saving}
                            disabled={invalid}
                            onClick={() => void transfer()}
                        >
                            {copy.transferTo(name)}
                        </LoadingButton>
                    ) : null}
                </>
            }
        >
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{copy.newOwner}</span>
                <MemberPicker
                    mode="single"
                    projectName={projectName}
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
                <p className="m-0 text-xs text-muted-foreground">{copy.transferHelp}</p>
                {invalid && target ? (
                    <p className="m-0 text-xs text-error">{copy.transferInvalid(name)}</p>
                ) : null}
            </div>
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
        </SharingSurface>
    )
}
