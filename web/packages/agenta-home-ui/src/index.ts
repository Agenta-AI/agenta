/**
 * @agenta/home-ui — Home, composed once for both apps.
 *
 * The page's shape (hero, composer, in-flight column, rail) lives here so the desktop app and
 * the mobile app cannot drift into two different pages. Anything only one app can render
 * (the expanded analytics dashboard, an app's routing verbs) arrives as a slot.
 */
export {HomeOverview, type HomeOverviewProps} from "./HomeOverview"
export {HomeFocus, type HomeFocusProps} from "./HomeFocus"
export {HomeGreeting} from "./HomeGreeting"
export {
    HomeEntityList,
    type HomeEntityListProps,
    type HomeListAgent,
    type HomeListTab,
} from "./HomeEntityList"
export {AgentsPanel, type AgentsPanelEntry, type AgentsPanelProps} from "./AgentsPanel"
export {NewAgentButton, type NewAgentButtonProps, type NewAgentTemplate} from "./NewAgentButton"
export {TemplateGallery, type TemplateGalleryProps} from "./TemplateGallery"
export {TemplateDetail, type TemplateDetailProps} from "./TemplateDetail"
export {TemplateCard, type TemplateCardProps} from "./TemplateCard"
export {TemplateProviderMarks} from "./TemplateProviderMarks"
export {
    useCreateAgent,
    type CreateAgentParams,
    type CreatedAgent,
    type UseCreateAgentOptions,
} from "./useCreateAgent"
export {UsageCard, type UsageCardProps} from "./UsageCard"
export {AnalyticsRangePicker, type AnalyticsRangePickerProps} from "./AnalyticsRangePicker"
export {
    HomeTaskComposer,
    type HomeComposerMode,
    type HomeComposerTemplate,
    type HomeTaskComposerAgent,
    type HomeTaskComposerProps,
} from "./HomeTaskComposer"
