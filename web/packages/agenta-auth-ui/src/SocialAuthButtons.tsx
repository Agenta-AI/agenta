import type {ReactNode} from "react"

import {CircleNotch} from "@phosphor-icons/react"
import clsx from "clsx"

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
            {providers.map((provider) => (
                <button
                    key={provider.id}
                    type="button"
                    className={clsx(
                        "relative",
                        yellow
                            ? "auth-btn-yellow"
                            : clsx(
                                  "auth-surface-btn",
                                  variant === "promoted" && "auth-surface-btn-promoted",
                              ),
                    )}
                    onClick={() => onSelect(provider.id)}
                    disabled={disabled || isLoading}
                >
                    {isLoading && provider.id === pendingProviderId ? (
                        <span key="busy" className="auth-swap">
                            <CircleNotch size={16} className="motion-safe:animate-spin" />
                            Redirecting to {provider.label}…
                        </span>
                    ) : (
                        <span key="idle" className="inline-flex items-center gap-2.5">
                            {provider.icon}
                            Continue with {provider.label}
                        </span>
                    )}
                    {provider.id === lastUsedProviderId && (
                        <span className="auth-last-used-tag absolute right-3">Last used</span>
                    )}
                </button>
            ))}
        </div>
    )
}
