import {useState, type ReactNode} from "react"

import {Button, Checkbox, Input} from "@agenta/ui/ui"
import {useMutation} from "@tanstack/react-query"

import {createInstanceRegistration, isRegistrationUnreachable} from "./licenseApi"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Ask Agenta for a free key for this instance; Agenta emails it with the activation link. */
export const RegistrationForm = ({
    projectId,
    defaultEmail,
    secondary,
    onRegistered,
}: {
    projectId: string
    defaultEmail?: string
    /** A quieter step beside the submit button, such as Skip. */
    secondary?: ReactNode
    onRegistered?: () => void
}) => {
    const [email, setEmail] = useState(defaultEmail ?? "")
    const [productUpdates, setProductUpdates] = useState(false)
    const register = useMutation({
        mutationFn: (value: string) => createInstanceRegistration(projectId, value, productUpdates),
        onSuccess: () => onRegistered?.(),
    })
    const trimmed = email.trim()
    const valid = EMAIL.test(trimmed)

    if (register.isSuccess) {
        return (
            <p role="status" className="text-foreground m-0 text-[13px]">
                Check your inbox. We sent a key to {register.data.email}.
            </p>
        )
    }

    return (
        <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
                event.preventDefault()
                if (valid && productUpdates) register.mutate(trimmed)
            }}
        >
            <label className="flex flex-col gap-1.5">
                <span className="text-foreground text-sm font-medium">Email</span>
                <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@company.com"
                    autoComplete="email"
                />
            </label>
            <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                    checked={productUpdates}
                    onCheckedChange={(checked) => setProductUpdates(checked === true)}
                />
                <span>Send me product updates. The free key needs this.</span>
            </label>
            {register.isError ? (
                <p role="alert" className="text-colorError m-0 text-sm">
                    {isRegistrationUnreachable(register.error)
                        ? "We could not reach Agenta. Try again later."
                        : "We could not send the request. Try again."}
                </p>
            ) : null}
            <div className="flex items-center gap-2">
                <Button type="submit" disabled={!valid || !productUpdates || register.isPending}>
                    {register.isPending ? "Sending…" : "Send me a key"}
                </Button>
                {secondary}
            </div>
        </form>
    )
}
