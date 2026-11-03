import {useState, type FormEvent} from "react"

import {ShowErrorMessage, FIELD_CLASS, KEYCAP_CLASS} from "@agenta/auth-ui"
import {Input, LoadingButton} from "@agenta/ui/ui"

import {submitNewPasswordDetailed} from "@/lib/auth"

export interface ResetPasswordFormProps {
    onDone: () => void
    onInvalidLink: () => void
}

/** New password twice, then one submit; SuperTokens reads the token from the page URL. */
export const ResetPasswordForm = ({onDone, onInvalidLink}: ResetPasswordFormProps) => {
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (saving) return
        if (!password) return setError("Enter a new password.")
        if (password !== confirm) return setError("The passwords do not match.")
        setError(null)
        setSaving(true)
        const outcome = await submitNewPasswordDetailed(password)
        setSaving(false)
        if (outcome.kind === "ok") onDone()
        else if (outcome.kind === "invalid-link") onInvalidLink()
        else if (outcome.kind === "field-error") setError(outcome.message)
        else setError("Something went wrong. Please try again.")
    }

    const invalid = error ? true : undefined

    return (
        <form className="flex w-full flex-col gap-[10px]" onSubmit={submit} noValidate>
            <Input
                type="password"
                autoComplete="new-password"
                aria-label="New password"
                aria-invalid={invalid}
                placeholder="New password"
                value={password}
                autoFocus
                size="lg"
                className={FIELD_CLASS}
                onChange={(event) => {
                    setPassword(event.target.value)
                    setError(null)
                }}
            />
            <Input
                type="password"
                autoComplete="new-password"
                aria-label="Confirm new password"
                aria-invalid={invalid}
                placeholder="Confirm new password"
                value={confirm}
                size="lg"
                className={FIELD_CLASS}
                onChange={(event) => {
                    setConfirm(event.target.value)
                    setError(null)
                }}
            />
            <LoadingButton type="submit" size="lg" loading={saving} className={KEYCAP_CLASS}>
                {saving ? "Saving…" : "Set password"}
            </LoadingButton>
            {error ? <ShowErrorMessage info={{message: error, type: "error"}} /> : null}
        </form>
    )
}
