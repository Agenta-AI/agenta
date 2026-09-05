/**
 * @agenta/skills-ui — presentational skill-registry surfaces (gallery, drawers, save
 * dialog content). Options in, callbacks out; data comes from @agenta/skills via the host.
 */
export * from "./types"
export {NewSkillMenuButton, type NewSkillMenuButtonProps} from "./NewSkillMenuButton"
export {SkillCard, SkillAvatar, VersionTag, type SkillCardProps} from "./SkillCard"
export {
    SkillsGalleryPage,
    type SkillsGalleryPageProps,
    type SkillGallerySection,
    type SkillSourceNavEntry,
} from "./SkillsGalleryPage"
export {VersionsRailCard, type VersionsRailCardProps} from "./VersionsRailCard"
export {
    SkillPickerDrawer,
    type SkillPickerDrawerProps,
    type SkillAddChoice,
} from "./SkillPickerDrawer"
export {SkillSaveBlastRadius, type SkillSaveBlastRadiusProps} from "./SkillSaveBlastRadius"
