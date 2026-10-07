import {EnvelopeSimple} from "@phosphor-icons/react"

export interface EmailChipProps {
    email: string
    /** Back to the address step. */
    onChange: () => void
}

/** The address a sign-in step carries forward, with a way back to change it. */
export const EmailChip = ({email, onChange}: EmailChipProps) => (
    <div className="auth-email-chip">
        <EnvelopeSimple size={14} className="flex-none text-[var(--a-faint)]" />
        <span className="truncate">{email}</span>
        <button type="button" className="auth-email-chip-change" onClick={onChange}>
            Change
        </button>
    </div>
)
