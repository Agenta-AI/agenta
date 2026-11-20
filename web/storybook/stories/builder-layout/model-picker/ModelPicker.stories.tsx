import {useState} from "react"

import {ModelPickerList} from "@agenta/ui/select-llm-provider"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {MODEL_PICKER_GROUPS} from "../../../fixtures/builderLayout/model-picker"

/** The Model view's body in a 440 px panel: the picker as one grouped list (F01 f2). */
const ModelViewFrame = () => {
    const [picked, setPicked] = useState("anthropic:claude-sonnet-5-5")
    return (
        <div
            data-testid="agent-panel"
            className="ag-panel-raised flex h-[720px] flex-col border border-solid border-border"
            style={{width: 440}}
        >
            <div data-testid="panel-view" className="flex min-h-0 flex-1 flex-col px-4 py-3">
                <ModelPickerList
                    options={MODEL_PICKER_GROUPS}
                    selectedKey={picked}
                    onChange={(_value, option) => setPicked(option.key ?? option.value)}
                    searchPlaceholder="Search models"
                    disabledGroupAction={{label: "Sign in", onClick: () => undefined}}
                    footer={
                        <Button variant="outline" className="w-full">
                            Manage model providers
                        </Button>
                    }
                />
            </div>
        </div>
    )
}

const meta = {
    title: "BuilderLayout/model-picker/Model picker",
    component: ModelViewFrame,
    parameters: {layout: "padded"},
} satisfies Meta<typeof ModelViewFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F01 f2: Agenta, an organization key, a key, a subscription, and one that needs a sign-in. */
export const Grouped: Story = {}
