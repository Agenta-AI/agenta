import {useContext} from "react"

import {useTriggerSchedules, useTriggerSubscriptions} from "@agenta/entities/gatewayTrigger"

import {AgentEditorContext} from "../useAgentConfigWriter"

import {hasAutomationWithoutPerson, type AutomationRunner} from "./integrationAccountSwitch"

/** Whether the agent has runs without a person: a channel, or an automation saved by an API key. */
export const useRunsWithoutPerson = (workflowId: string): boolean => {
    const hasChannel = useContext(AgentEditorContext)?.hasChannel ?? false
    const {subscriptions} = useTriggerSubscriptions()
    const {schedules} = useTriggerSchedules()
    return (
        hasChannel ||
        hasAutomationWithoutPerson(subscriptions as AutomationRunner[], workflowId) ||
        hasAutomationWithoutPerson(schedules as AutomationRunner[], workflowId)
    )
}
