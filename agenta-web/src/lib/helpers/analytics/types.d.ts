import {type PostHogConfig} from "./store/atoms"

export interface CustomPosthogProviderType
    extends React.FC<{
        children: React.ReactNode
    }> {}
