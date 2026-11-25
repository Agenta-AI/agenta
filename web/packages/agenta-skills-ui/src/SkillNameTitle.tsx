import {useId} from "react"

import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {cn} from "@agenta/ui/styles"

/** The skill's name as the page heading, edited in place; read-only, a plain heading. */
export function SkillNameTitle({
    value,
    onChange,
    readOnly,
    disabled,
    invalid,
    error,
    autoFocus,
}: {
    value: string
    onChange: (next: string) => void
    readOnly?: boolean
    disabled?: boolean
    invalid?: boolean
    /** Shown under the name when it is invalid. */
    error?: string
    autoFocus?: boolean
}) {
    const t = useT(skillsEditorCatalog)
    const errorId = useId()
    if (readOnly)
        return <h1 className="m-0 min-w-0 truncate text-heading text-foreground">{value}</h1>
    const showError = Boolean(invalid && error)
    return (
        // Hangs 8px left so the typed text stays on the alignment line (FORM-02).
        <div className="-ml-2 flex min-w-0 flex-col gap-1">
            <h1 className="m-0 min-w-0">
                <input
                    value={value}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    aria-label={t("skills.editor.name")}
                    aria-invalid={invalid || undefined}
                    aria-describedby={showError ? errorId : undefined}
                    placeholder={t("skills.editor.namePlaceholder")}
                    onChange={(event) => onChange(event.target.value)}
                    className={cn(
                        "box-border h-control w-full truncate rounded-md border border-solid bg-transparent px-2 py-0 font-[inherit] text-heading text-foreground transition-colors duration-[var(--duration-fast)] placeholder:text-muted-foreground focus:bg-transparent focus-ring-field disabled:opacity-60 motion-reduce:transition-none",
                        invalid ? "border-destructive" : "border-transparent",
                        !disabled && "hover:bg-accent",
                    )}
                />
            </h1>
            {showError ? (
                <p id={errorId} className="m-0 px-2 text-meta text-destructive">
                    {error}
                </p>
            ) : null}
        </div>
    )
}
