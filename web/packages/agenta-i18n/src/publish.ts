import catalog from "../locales/en/publish.json"

import {defineNamespace} from "./namespace"

export const {t, useT} = defineNamespace("publish", catalog)
