/**
 * Every user-facing string of the agent privacy and owner UI. Source: the approved M3 UI design
 * copy deck. Placeholders are functions. The member picker and the share disclosure live in
 * `@agenta/sessions-ui` (the chat Share dialog uses them too); their strings are re-exported here.
 */
import {joinNames} from "@agenta/sessions-ui/sharing"

export {joinNames, memberPickerCopy, shareDisclosureCopy} from "@agenta/sessions-ui/sharing"

export const agentSharingCopy = {
    menuItem: "Privacy and owner",
    dialogTitle: "Privacy and owner",

    triggerPrivate: "Private",
    triggerShared: "Shared",
    triggerAriaPrivate: "Private agent. Change who can see this agent",

    panelTitle: "Who can see this agent",
    linePrivate: "Only you can see and use it.",
    lineProject: (project: string) => `Everyone in ${project} can see and use it.`,
    panelOwnerYou: (name: string) => `${name} (you), owner`,
    change: "Change",

    whoSection: "Who can see this agent",
    cardPrivate: "Private",
    cardProject: "Shared with project",
    ownerSection: "Owner",
    ownerRole: "Owner",
    youSuffix: "(you)",
    transferButton: "Transfer ownership",
    done: "Done",
    cancel: "Cancel",

    makePrivateTitle: (agent: string) => `Make ${agent} private?`,
    makePrivateBody:
        "Other members will no longer see or run this agent. They can still read the chats they already had with it, but they cannot send to them.",
    makePrivate: "Make private",

    transferTitle: "Transfer ownership",
    newOwner: "New owner",
    transferHelp: "Only members of this project can own the agent.",
    transferPrivateWarning: (name: string) =>
        `This agent is private. After the transfer only ${name} can see it, and you lose access. You cannot undo this yourself.`,
    transferPrivateChats:
        "Your chats with this agent stay yours. You can read them, but you cannot send to them.",
    transferShared: (name: string) =>
        `${name} will decide who can see this agent. You will no longer be able to make it private or change its owner.`,
    transferTo: (name: string) => `Transfer to ${name}`,
    transferInvalid: (name: string) =>
        `${name} is no longer a member of this project. Pick someone else.`,
    back: "Back",

    notOwner: (owner: string) => `Only ${owner} can make this agent private or change its owner.`,
    ownerLeft: (owner: string) =>
        `${owner} left this project, so this agent has no owner. It stays shared with the project.`,
    ownerLeftNonAdmin: "A project admin can take ownership.",
    noOwner:
        "An API key or an automation created this agent, so it has no owner and is shared with the project.",
    takeOwnership: "Take ownership",
    takeOwnershipHelp: "You become the owner and can make it private.",
    ownerActive: (owner: string) =>
        `${owner} is a member of this project again, so you cannot take ownership.`,
    conflict:
        "The privacy or owner of this agent changed while you had this open. We loaded the latest settings. Check them and try again.",
    saveFailed: "Couldn't save the change. Try again.",
    loadError: "Couldn't load the privacy settings of this agent.",
    retry: "Try again",
    channelsOff: (platforms: readonly string[]) =>
        `This agent no longer answers in ${joinNames(platforms)}. Turn ${joinNames(platforms)} back on in Channels.`,
    openChannels: "Open Channels",

    toastPrivate: (agent: string) => `${agent} is now private.`,
    toastShared: (agent: string) => `${agent} is now shared with the project.`,
    toastTransferred: (name: string, agent: string) => `${name} now owns ${agent}.`,
    toastTookOwnership: (agent: string) => `You now own ${agent}.`,
} as const
