import {useState, type FormEvent} from "react"

import {ShowErrorMessage, FIELD_CLASS, KEYCAP_CLASS, useAuthFailureText} from "@agenta/auth-ui"
import {useT} from "@agenta/i18n"
import resetCatalog from "@agenta/i18n/catalogs/auth.resetPassword"
import {Input, LoadingButton} from "@agenta/ui/ui"

import {submitNewPasswordDetailed} from "@/lib/auth"

export interface ResetPasswordFormProps {
    onDone: () => void
    onInvalidLink: () => void
}

/** New password twice, then one submit; SuperTokens reads the token from the page URL. */
export const ResetPasswordForm = ({onDone, onInvalidLink}: ResetPasswordFormProps) => {
    const t = useT(resetCatalog)
    const failureText = useAuthFailureText()
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (saving) return
        if (!password) return setError(t("auth.resetPassword.enterNewPassword"))
        if (password !== confirm) return setError(t("auth.resetPassword.passwordsDoNotMatch"))
        setError(null)
        setSaving(true)
        const outcome = await submitNewPasswordDetailed(password)
        setSaving(false)
        if (outcome.kind === "ok") onDone()
        else if (outcome.kind === "invalid-link") onInvalidLink()
        else if (outcome.kind === "field-error") setError(outcome.message)
        else setError(failureText(outcome.failure))
    }

    const invalid = error !== null ? true : undefined

    return (
        <form className="flex w-full flex-col gap-[10px]" onSubmit={submit} noValidate>
            <Input
                type="password"
                autoComplete="new-password"
                aria-label={t("auth.resetPassword.newPassword")}
                aria-invalid={invalid}
                placeholder={t("auth.resetPassword.newPassword")}
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
                aria-label={t("auth.resetPassword.confirmNewPassword")}
                aria-invalid={invalid}
                placeholder={t("auth.resetPassword.confirmNewPassword")}
                value={confirm}
                size="lg"
                className={FIELD_CLASS}
                onChange={(event) => {
                    setConfirm(event.target.value)
                    setError(null)
                }}
            />
            <LoadingButton type="submit" size="lg" loading={saving} className={KEYCAP_CLASS}>
                {saving ? t("auth.resetPassword.saving") : t("auth.resetPassword.setPassword")}
            </LoadingButton>
            {error !== null ? <ShowErrorMessage info={{message: error, type: "error"}} /> : null}
        </form>
    )
}
