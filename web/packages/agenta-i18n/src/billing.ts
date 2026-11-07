import catalog from "../locales/en/billing.json"

import {defineNamespace} from "./namespace"

export const {t, useT} = defineNamespace("billing", catalog)
