import {useState, type FormEvent} from "react"

import {signInWithEmailPassword} from "@/lib/auth"

import {authFieldClass, authPrimaryButtonClass} from "./authStyles"

interface EmailPasswordFormProps {
    onSuccess: () => Promise<void>
}

export const EmailPasswordForm = ({onSuccess}: EmailPasswordFormProps) => {
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (pending) return
        setPending(true)
        setError(null)
        const outcome = await signInWithEmailPassword(email.trim(), password)
        if (outcome.kind === "ok") {
            await onSuccess()
            return
        }
        setPending(false)
        setError(outcome.kind === "rejected" ? outcome.message : "Something went wrong. Try again.")
    }

    return (
        <form className="flex w-full flex-col gap-3" onSubmit={onSubmit}>
            <input
                type="email"
                autoComplete="email"
                required
                placeholder="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={authFieldClass}
            />
            <input
                type="password"
                autoComplete="current-password"
                required
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={authFieldClass}
            />
            {error ? (
                <p className="text-destructive text-xs" role="alert">
                    {error}
                </p>
            ) : null}
            <button type="submit" disabled={pending} className={authPrimaryButtonClass}>
                {pending ? "Signing in…" : "Sign in"}
            </button>
        </form>
    )
}
