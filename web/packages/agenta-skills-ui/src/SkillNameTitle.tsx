import {useT} from "@agenta/i18n"
import skillsEditorCatalog from "@agenta/i18n/catalogs/skills.editor"
import {cn} from "@agenta/ui/styles"

/** The skill's name as the page heading, edited in place. */
export function SkillNameTitle({
    value,
    onChange,
    readOnly,
    invalid,
}: {
    value: string
    onChange: (next: string) => void
    readOnly?: boolean
    invalid?: boolean
}) {
    const t = useT(skillsEditorCatalog)
    return (
        <h1 className="m-0 min-w-0">
            <input
                value={value}
                readOnly={readOnly}
                aria-label={t("skills.editor.name")}
                aria-invalid={invalid || undefined}
                placeholder={t("skills.editor.namePlaceholder")}
                onChange={(event) => onChange(event.target.value)}
                className={cn(
                    "-ml-2 box-border w-[calc(100%+8px)] truncate rounded-md border border-solid border-transparent bg-transparent px-2 py-0.5 font-[inherit] text-heading text-foreground outline-none transition-colors duration-[var(--duration-fast)] placeholder:text-muted-foreground focus:border-input motion-reduce:transition-none",
                    !readOnly && "hover:bg-accent focus:bg-transparent",
                    invalid && "border-destructive focus:border-destructive",
                )}
            />
        </h1>
    )
}
