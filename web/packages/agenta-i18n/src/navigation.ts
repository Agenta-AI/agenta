import catalog from "../locales/en/navigation.json"

import {defineNamespace} from "./namespace"

export const {t, useT} = defineNamespace("navigation", catalog)
