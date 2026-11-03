import {type Mount} from "@agenta/entities/session"

/** Breadcrumb root label. Mount slugs are the RESERVED form (`__ag__<uuid5>__cwd`) — surface
 * only the human tail ("cwd"), never the uuid (spec: raw ids stay out of labels). */
export const driveRootLabel = (mount: Mount | null): string =>
    mount?.slug?.split("__").filter(Boolean).pop() ?? "cwd"
