import type {ReactNode} from "react"

import {LoadingButton, cn} from "@agenta/ui/ui"

import {KEYCAP_CLASS, SURFACE_CLASS} from "./classes"
import {LastUsedBadge} from "./LastUsedBadge"

export interface SocialProvider {
    id: string
    label: string
    icon?: ReactNode
}

export interface SocialAuthButtonsProps {
    providers: SocialProvider[]
    /** Starts the provider flow — each app owns its redirect flavor. */
    onSelect: (providerId: string) => void
    isLoading?: boolean
    disabled?: boolean
    /** "promoted" = taller, stronger ring (returning last-used slot). */
    variant?: "default" | "promoted"
    /** Yellow keycap treatment (the one primary action on the screen). */
    yellow?: boolean
    /** Tags exactly one provider with the inline "Last used" badge. */
    lastUsedProviderId?: string
    /** The provider whose redirect is starting; it shows a spinner while `isLoading`. */
    pendingProviderId?: string
}

export const SocialAuthButtons = ({
    providers,
    onSelect,
    isLoading,
    disabled,
    variant = "default",
    yellow = false,
    lastUsedProviderId,
    pendingProviderId,
}: SocialAuthButtonsProps) => {
    if (providers.length === 0) return null

    return (
        <div className="flex flex-col gap-[10px]">
            {providers.map((provider) => {
                const pending = Boolean(isLoading) && provider.id === pendingProviderId
                return (
                    <LoadingButton
                        key={provider.id}
                        type="button"
                        variant={yellow ? "default" : "outline"}
                        size="lg"
                        loading={pending}
                        className={cn(
                            "relative",
                            yellow ? KEYCAP_CLASS : SURFACE_CLASS,
                            variant === "promoted" && !yellow && "h-12 border-ring",
                        )}
                        onClick={() => onSelect(provider.id)}
                        disabled={disabled || (isLoading && !pending)}
                    >
                        <span key={pending ? "busy" : "idle"} className="auth-swap">
                            {pending ? null : provider.icon}
                            {pending
                                ? `Redirecting to ${provider.label}…`
                                : `Continue with ${provider.label}`}
                        </span>
                        {provider.id === lastUsedProviderId && !pending && (
                            <LastUsedBadge className="absolute right-3" />
                        )}
                    </LoadingButton>
                )
            })}
        </div>
    )
}
