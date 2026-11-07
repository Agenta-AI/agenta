import catalog from "../locales/en/common.json"

import {defineNamespace} from "./namespace"

export const {t, useT} = defineNamespace("common", catalog)
