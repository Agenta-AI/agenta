import {getDefaultStore} from "jotai"
import {isAddAppFromTemplatedAtom} from "@/oss/components/pages/app-management/state/atom"
import {
    closeCustomWorkflowModalAtom,
    openCustomWorkflowModalAtom,
} from "../../customWorkflow/modalAtoms"
import {OnboardingStepsContext, TourDefinition} from "./types"

const openTemplateModal = () => {
    getDefaultStore().set(isAddAppFromTemplatedAtom, true)
}

const closeTemplateModal = () => {
    getDefaultStore().set(isAddAppFromTemplatedAtom, false)
}

const closeCustomWorkflowModal = () => {
    getDefaultStore().set(closeCustomWorkflowModalAtom)
}

const openCustomWorkflowModal = () => {
    getDefaultStore().set(openCustomWorkflowModalAtom, {
        open: true,
        onCancel: () => {
            closeCustomWorkflowModal()
        },
        handleCreateApp: () => {},
        configureWorkflow: false,
        appId: "new-app",
    })
}

export const GLOBAL_APP_MANAGEMENT_STEPS = [
    {
        icon: "🚀",
        title: "Create a new prompt",
        content: (
            <span>
                This card opens the guided flow for app creation. Click it to launch the template
                library.
            </span>
        ),
        selector: "#tour-create-new-prompt",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: closeTemplateModal,
        onCleanup: closeTemplateModal,
    },
    {
        icon: "📝",
        title: "Name your app",
        content: (
            <span>
                Give your app a descriptive name so teammates immediately understand its purpose.
            </span>
        ),
        selector: "#tour-app-name-input",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openTemplateModal,
        onCleanup: closeTemplateModal,
    },
    {
        icon: "📚",
        title: "Choose a template",
        content: (
            <span>
                Select a template that fits your workflow. You can customize it further after
                creation.
            </span>
        ),
        selector: "#tour-template-list",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openTemplateModal,
        onCleanup: closeTemplateModal,
    },
    {
        icon: "✅",
        title: "Create the app",
        content: <span>Provision your first app by creating it with the selected template.</span>,
        selector: "#tour-create-app-button",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openTemplateModal,
        onCleanup: closeTemplateModal,
    },
]

export const CUSTOM_APPS_CREATION_STEPS = [
    {
        icon: "🚀",
        title: "Create a custom app",
        content: (
            <span>
                This card opens the guided flow for app creation. Click it to launch the template
                library.
            </span>
        ),
        selector: "#tour-create-custom-app",
        side: "bottom",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        userRole: ["Hobbyist"],
        onEnter: closeCustomWorkflowModal,
        onCleanup: closeCustomWorkflowModal,
    },
    {
        icon: "📝",
        title: "Name your app",
        content: (
            <span>
                Give your app a descriptive name so teammates immediately understand its purpose.
            </span>
        ),
        selector: "#tour-custom-app-name-input",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openCustomWorkflowModal,
        onCleanup: closeCustomWorkflowModal,
    },
    {
        icon: "📚",
        title: "Add your custom workflow URL",
        content: (
            <span>
                Add your custom workflow URL to connect your app to Agenta. Check docs for more
                details.{" "}
                <a href="https://docs.agenta.ai/custom-workflows/quick-start">
                    Learn more about custom workflows
                </a>
            </span>
        ),
        selector: "#tour-custom-app-url-input",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openCustomWorkflowModal,
        onCleanup: closeCustomWorkflowModal,
    },
    {
        icon: "✅",
        title: "Create the app",
        content: <span>Provision your first app by creating it with the selected template.</span>,
        selector: "#tour-create-custom-app-button",
        side: "top",
        showControls: true,
        showSkip: true,
        pointerPadding: 12,
        pointerRadius: 12,
        onEnter: openCustomWorkflowModal,
        onCleanup: closeCustomWorkflowModal,
    },
]
const resolveGlobalAppTour = (): TourDefinition => {
    return [
        {
            tour: "create-first-app",
            steps: GLOBAL_APP_MANAGEMENT_STEPS,
        },
    ]
}

const APP_MANAGEMENT_TOUR_MAP: Record<string, (ctx: OnboardingStepsContext) => TourDefinition> = {
    Hobbyist: () => resolveGlobalAppTour(),
    "ML/AI Engineer or Data scientist": () => {
        return [
            {
                tour: "create-first-custom-app",
                steps: CUSTOM_APPS_CREATION_STEPS,
            },
        ]
    },
    "Frontend / Backend Developer": () => resolveGlobalAppTour(),
}

export const APP_MANAGEMENT_TOURS = new Proxy(APP_MANAGEMENT_TOUR_MAP, {
    get(target, prop: string | symbol) {
        if (typeof prop === "string" && prop in target) {
            return target[prop]
        }
        return target.Hobbyist
    },
}) as typeof APP_MANAGEMENT_TOUR_MAP
