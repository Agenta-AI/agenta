import {AutomationDetailBody} from "@agenta/automation-ui"
import {createT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {DAILY_SUMMARY, runHistoryQueries} from "../../../fixtures/builderLayout/automations"

const noop = () => undefined
const t = createT(automationsScreensCatalog)

/** The automation view in a 440px panel column (F05 f5): "Runs", then "Settings". */
const PanelAutomation = () => (
    <div
        data-testid="automation-view-panel"
        className="ag-panel-raised flex h-[720px] w-[440px] flex-col overflow-y-auto border border-solid border-border"
    >
        <AutomationDetailBody
            automation={DAILY_SUMMARY}
            preview={DAILY_SUMMARY}
            agentName="Support triage"
            className="flex min-w-0 flex-col px-4 pb-6 pt-2"
            onOpenRunHistory={noop}
            dirty={false}
            saving={false}
            onRename={async () => true}
            onChangeCron={noop}
            onSelectEvent={noop}
            onChangeInputs={noop}
            includeEvent={false}
            onChangeIncludeEvent={noop}
            onToggle={async () => undefined}
            onDiscard={noop}
            onSave={noop}
            runNow={
                <button type="button" className="rounded-md border px-2 py-0.5 text-xs">
                    Run now
                </button>
            }
        />
    </div>
)

const meta = {
    title: "BuilderLayout/automations/Automation view",
    component: PanelAutomation,
    parameters: {
        layout: "padded",
        agenta: {queries: (scope: StoryScope) => runHistoryQueries(scope)},
    },
} satisfies Meta<typeof PanelAutomation>

export default meta
type Story = StoryObj<typeof meta>

/** F05 f5: "Runs" with the next run, the last run and the history; "Settings" below. */
export const DailySummary: Story = {}

/** F06 f4: "Delete this automation?". */
export const DeleteDialog: StoryObj = {
    render: () => (
        <AlertDialog open>
            <AlertDialogContent data-testid="automation-delete-dialog">
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("automations.screens.deleteTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t("automations.screens.deleteMessage", {name: "Daily summary"})}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                        <Button variant="outline">{t("automations.screens.cancel")}</Button>
                    </AlertDialogCancel>
                    <Button variant="destructive">{t("automations.screens.delete")}</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    ),
}
