import {turnRowClass} from "@agenta/ui/components/presentational"

import {cn} from "@/lib/utils"

/** The desktop row's bottom band, trimmed to what the hover meta line needs: a phone has less to spare. */
export const mobileTurnRowClass = cn(turnRowClass, "pb-6")
