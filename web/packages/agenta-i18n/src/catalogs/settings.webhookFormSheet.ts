import en from "../../locales/en/settings.webhookFormSheet.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.webhookFormSheet",
    en,
    (language) => import(`../../locales/${language}/settings.webhookFormSheet.json`),
)
