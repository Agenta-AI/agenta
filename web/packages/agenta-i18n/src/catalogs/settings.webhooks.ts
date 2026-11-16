import en from "../../locales/en/settings.webhooks.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.webhooks",
    en,
    (language) => import(`../../locales/${language}/settings.webhooks.json`),
)
