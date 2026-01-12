import {type PostHogConfig} from "posthog-js"

export interface CustomPosthogProviderType extends React.FC<{
    children: React.ReactNode
    config: Partial<PostHogConfig>
}> {}
