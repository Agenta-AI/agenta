import {atom} from "jotai"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

const enabled = getEnv("NEXT_PUBLIC_AGENTA_EVAL_UNIFIED_DRAWER") === "true"

export const evalUnifiedDrawerEnabledAtom = atom(enabled)
