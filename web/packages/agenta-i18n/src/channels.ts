import catalog from "../locales/en/channels.json"

import {defineNamespace} from "./namespace"

export const {t, useT} = defineNamespace("channels", catalog)
