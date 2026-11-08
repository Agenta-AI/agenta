import type {Meta, StoryObj} from "@storybook/nextjs"

import {CreditAlertNotice} from "../../../mobile/src/features/wallet/CreditAlertNotice"

/** The low-credit strip above the chat composer, one story per wallet state and model route. */
const meta = {
    title: "@agenta/mobile/Developer/Wallet/CreditAlertNotice",
    component: CreditAlertNotice,
    parameters: {layout: "padded"},
    args: {
        alert: {kind: "low", remainingMusd: 2_400_000},
        funding: "credits-with-own-key",
        canBuy: true,
        onAction: () => {},
        onDismiss: () => {},
    },
    decorators: [
        (Story) => (
            <div className="max-w-[720px]">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof CreditAlertNotice>

export default meta
type Story = StoryObj<typeof meta>

export const LowOnBuiltInModelWithOwnKey: Story = {}

export const LowOnBuiltInModelNoKey: Story = {args: {funding: "credits-no-own-key"}}

export const LowOnOwnKey: Story = {args: {funding: "own-key"}}

export const LowForMember: Story = {args: {canBuy: false}}

export const Empty: Story = {args: {alert: {kind: "empty"}}}

export const EmptyForMember: Story = {args: {alert: {kind: "empty"}, canBuy: false}}

export const DailyOnly: Story = {
    args: {alert: {kind: "daily", todayMusd: 400_000, refills: true}, funding: "own-key"},
}

export const DailyCapReached: Story = {
    args: {alert: {kind: "daily", todayMusd: 400_000, refills: false}, funding: "own-key"},
}

export const DailyGrantPending: Story = {
    args: {alert: {kind: "daily", todayMusd: null, refills: true}},
}
