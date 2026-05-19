import {atom} from "jotai"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export const evalUnifiedDrawerEnabledAtom = atom(
    () => getEnv("NEXT_PUBLIC_AGENTA_EVAL_UNIFIED_DRAWER") === "true",
)
