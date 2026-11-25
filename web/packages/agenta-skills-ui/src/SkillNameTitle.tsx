import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {cn} from "@agenta/ui/styles"

/** The skill's name as the page heading, edited in place; read-only, a plain heading. */
export function SkillNameTitle({
    value,
    onChange,
    readOnly,
    invalid,
    autoFocus,
}: {
    value: string
    onChange: (next: string) => void
    readOnly?: boolean
    invalid?: boolean
    autoFocus?: boolean
}) {
    const t = useT(skillsEditorCatalog)
    if (readOnly)
        return <h1 className="m-0 min-w-0 truncate text-heading text-foreground">{value}</h1>
    return (
        <h1 className="m-0 min-w-0">
            <input
                value={value}
                autoFocus={autoFocus}
                aria-label={t("skills.editor.name")}
                aria-invalid={invalid || undefined}
                placeholder={t("skills.editor.namePlaceholder")}
                onChange={(event) => onChange(event.target.value)}
                // The box hangs 8px left so the text stays on the alignment line; it is as tall as the
                // title row (control height), and the focus ring is the field's (FORM-02).
                className={cn(
                    "-ml-2 box-border h-control w-[calc(100%+8px)] truncate rounded-md border border-solid border-transparent bg-transparent px-2 py-0 font-[inherit] text-heading text-foreground transition-colors duration-[var(--duration-fast)] placeholder:text-muted-foreground hover:bg-accent focus:bg-transparent focus-ring-field motion-reduce:transition-none",
                    invalid && "border-destructive",
                )}
            />
        </h1>
    )
}
