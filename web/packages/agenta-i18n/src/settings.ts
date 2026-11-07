import billing from "../locales/en/billing.json"
import channels from "../locales/en/channels.json"
import publish from "../locales/en/publish.json"
import catalog from "../locales/en/settings.json"

import {defineNamespace} from "./namespace"

// Settings pages also show billing, channels and publish text, so this entry carries them too.
export const {t, useT} = defineNamespace("settings", catalog, {billing, channels, publish})
