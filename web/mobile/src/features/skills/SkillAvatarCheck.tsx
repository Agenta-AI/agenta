import {SkillCheckTile} from "@agenta/skills-ui"
import {cn} from "@agenta/ui/styles"

/** The skill tile; on hover it turns into the row's checkbox. */
export const SkillAvatarCheck = ({
    title,
    checked,
    selecting,
    onToggle,
    size = 32,
}: {
    title: string
    checked: boolean
    /** Any row is selected: unselected tiles get a dashed edge. */
    selecting: boolean
    onToggle: () => void
    size?: 32 | 40
}) => (
    <label
        className={cn(
            "group/check relative flex shrink-0 cursor-pointer",
            size === 40 ? "rounded-xl" : "rounded-[9px]",
            "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground",
        )}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
    >
        <input
            type="checkbox"
            className="absolute inset-0 z-[1] m-0 size-full cursor-pointer opacity-0"
            checked={checked}
            onChange={onToggle}
            aria-label={`Select ${title}`}
        />
        <SkillCheckTile checked={checked} selecting={selecting} size={size} />
    </label>
)
