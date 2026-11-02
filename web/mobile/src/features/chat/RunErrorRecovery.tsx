import {useState} from "react"

import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut, type Icon} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {RunErrorBuyCreditsDialog} from "./RunErrorBuyCreditsDialog"
import {RunErrorPlansDialog} from "./RunErrorPlansDialog"
import {RunErrorProviderDrawer} from "./RunErrorProviderDrawer"

/** Where a way out leads: a surface opened over the chat, the provider's own site, or a route. */
export type RunErrorRecoveryTarget =
    | {kind: "providers"; providerKind?: string}
    | {kind: "buy-credits"}
    | {kind: "plans"}
    | {kind: "external"; href: string}
    | {kind: "route"; onClick: () => void}

export interface RunErrorRecoveryAction {
    icon: Icon
    title: string
    description: string
    /** The verb on the card's button: "Buy credits". */
    cta: string
    target: RunErrorRecoveryTarget
}

type Surface = "providers" | "buy-credits" | "plans"

/** The ways out of a failed run, as small cards under the message; each opens in place. */
export const RunErrorRecovery = ({actions}: {actions: RunErrorRecoveryAction[]}) => {
    const router = useRouter()
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : null
    const [open, setOpen] = useState<Surface | null>(null)
    const [providerKind, setProviderKind] = useState<string | undefined>()
    // Mounted from the first open on, so a surface's queries run only once a card is used.
    const [used, setUsed] = useState<Surface[]>([])
    const show = (surface: Surface) => {
        setUsed((list) => (list.includes(surface) ? list : [...list, surface]))
        setOpen(surface)
    }
    const run = (target: RunErrorRecoveryTarget) => {
        if (target.kind === "route") return target.onClick()
        if (target.kind === "external") return
        if (target.kind === "providers") setProviderKind(target.providerKind)
        show(target.kind)
    }

    if (!actions.length) return null

    return (
        <>
            <div className="flex w-full max-w-[460px] flex-col gap-2">
                {actions.map(({icon: Glyph, title, description, cta, target}, i) => {
                    // The first card is the way the message suggests first.
                    const variant = i === 0 ? "default" : "outline"
                    return (
                        <div
                            key={title}
                            className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card p-2"
                        >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                                <Glyph size={16} />
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-xs font-medium text-foreground">
                                    {title}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                    {description}
                                </span>
                            </div>
                            {target.kind === "external" ? (
                                <Button size="sm" variant={variant} asChild>
                                    <a href={target.href} target="_blank" rel="noopener noreferrer">
                                        {cta}
                                        <ArrowSquareOut size={12} />
                                    </a>
                                </Button>
                            ) : (
                                <Button size="sm" variant={variant} onClick={() => run(target)}>
                                    {cta}
                                </Button>
                            )}
                        </div>
                    )
                })}
            </div>

            {used.includes("providers") ? (
                <RunErrorProviderDrawer
                    open={open === "providers"}
                    onClose={() => setOpen(null)}
                    providerKind={providerKind}
                />
            ) : null}
            {projectId && used.includes("buy-credits") ? (
                <RunErrorBuyCreditsDialog
                    projectId={projectId}
                    open={open === "buy-credits"}
                    onOpenChange={(next) => setOpen(next ? "buy-credits" : null)}
                    onUpgrade={() => show("plans")}
                />
            ) : null}
            {projectId && used.includes("plans") ? (
                <RunErrorPlansDialog
                    projectId={projectId}
                    open={open === "plans"}
                    onOpenChange={(next) => setOpen(next ? "plans" : null)}
                />
            ) : null}
        </>
    )
}
