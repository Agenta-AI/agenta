import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not export the accounts parts.
import {AccountSwitch} from "../../../../packages/agenta-entity-ui/src/accounts/AccountSwitch"

const choices = [
    {value: "user", label: "Each person's own", note: "Everyone uses their own Zendesk account."},
    {value: "agent", label: "One shared account", note: "Everyone uses the account you pick."},
]

const Demo = ({initial, disabled}: {initial: string; disabled?: boolean}) => {
    const [value, setValue] = useState(initial)
    return (
        <div data-testid="account-switch" className="w-[408px] bg-colorBgContainer p-4">
            <AccountSwitch
                value={value}
                choices={choices}
                onChange={setValue}
                aria-label="Account"
                disabled={disabled}
            />
        </div>
    )
}

const meta: Meta<typeof Demo> = {
    title: "BuilderLayout/integrations/Account switch",
    component: Demo,
}
export default meta

type Story = StoryObj<typeof Demo>

/** F10 f1: each person's own account. */
export const EachPersonsOwn: Story = {args: {initial: "user"}}
/** F10 f4: one shared account. */
export const OneSharedAccount: Story = {args: {initial: "agent"}}
/** A reader who may not edit the agent. */
export const Disabled: Story = {args: {initial: "user", disabled: true}}
