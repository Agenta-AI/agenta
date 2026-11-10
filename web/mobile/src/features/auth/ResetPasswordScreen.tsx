import {useEffect, useState} from "react"

import {AuthShell, HEADLINE_CLASS, KEYCAP_CLASS, SUBLINE_CLASS} from "@agenta/auth-ui"
import {Button} from "@agenta/ui/ui"
import Link from "next/link"
import {useRouter} from "next/router"

import {AgentaLogo} from "@/components/AgentaLogo"

import {ResetPasswordForm} from "./ResetPasswordForm"

type Stage = "form" | "done" | "invalid"

const COPY: Record<Stage, {heading: string; subheading: string}> = {
    form: {
        heading: "Set a new password",
        subheading: "Choose a new password for your Agenta account.",
    },
    done: {
        heading: "Password updated",
        subheading: "Sign in with your new password.",
    },
    invalid: {
        heading: "This link no longer works",
        subheading: "Reset links work once and expire. Ask your workspace admin for a new link.",
    },
}

/** The page a member password reset link opens. A link with no token is already a dead link. */
export const ResetPasswordScreen = () => {
    const router = useRouter()
    const [result, setResult] = useState<Exclude<Stage, "form"> | null>(null)
    const hasToken = typeof router.query.token === "string" && router.query.token !== ""
    // In an effect so the first client render matches the server's.
    useEffect(() => {
        if (router.isReady && !hasToken) setResult("invalid")
    }, [router.isReady, hasToken])
    const stage: Stage = result ?? "form"
    const {heading, subheading} = COPY[stage]

    return (
        <AuthShell header={<AgentaLogo className="h-[23px] w-auto text-foreground" />}>
            <div key={stage} className="flex flex-col gap-[22px] auth-step-fwd">
                <header className="flex flex-col gap-1">
                    <h1 className={HEADLINE_CLASS}>{heading}</h1>
                    <p className={SUBLINE_CLASS}>{subheading}</p>
                </header>
                {stage === "form" ? (
                    <ResetPasswordForm
                        onDone={() => setResult("done")}
                        onInvalidLink={() => setResult("invalid")}
                    />
                ) : (
                    <Button asChild size="lg" className={KEYCAP_CLASS}>
                        <Link href="/auth">
                            {stage === "done" ? "Go to sign in" : "Back to sign in"}
                        </Link>
                    </Button>
                )}
            </div>
        </AuthShell>
    )
}
