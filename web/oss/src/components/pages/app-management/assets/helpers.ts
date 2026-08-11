import {isDemo} from "@/oss/lib/helpers/utils"

export const timeout = isDemo() ? 60000 : 30000
