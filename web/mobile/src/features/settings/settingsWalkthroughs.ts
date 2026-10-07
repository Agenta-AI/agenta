import type {SettingsTabKey} from "@agenta/settings"

import type {Walkthrough} from "../education/featureGuides"

/** Walkthrough clips per Settings tab; a tab without one shows no video link. */
export const SETTINGS_WALKTHROUGHS: Partial<Record<SettingsTabKey, Walkthrough>> = {
    llms: {
        title: "AI providers",
        headline: "Connect your ChatGPT subscription in Agenta",
        docsUrl: "https://agenta.ai/docs/faq/integrations/llm-providers",
        video: {
            id: "d0af696808496c129cd42e8b1c651b56",
            title: "Connect your ChatGPT subscription in Agenta",
            stillSeconds: 0,
        },
    },
}
