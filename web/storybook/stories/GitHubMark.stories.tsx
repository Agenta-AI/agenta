import {GitHubMark} from "@agenta/ui/github-mark"
import type {Meta, StoryObj} from "@storybook/react-vite"

const meta = {title: "Primitives/GitHubMark", component: GitHubMark} satisfies Meta<
    typeof GitHubMark
>
export default meta
export const Default: StoryObj<typeof meta> = {}
