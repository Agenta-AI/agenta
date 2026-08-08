import type {ReactNode} from "react"

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
    /** Render the inline "Last used" tag. */
    lastUsed?: boolean
}

export const SocialAuthButtons = ({
    providers,
    onSelect,
    isLoading,
    disabled,
    variant = "default",
    yellow = false,
    lastUsed = false,
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
                    {provider.icon}
                    <span>Continue with {provider.label}</span>
                    {lastUsed && (
                        <span className="auth-last-used-tag absolute right-3">Last used</span>
                    )}
                </button>
            ))}
        </div>
    )
}
