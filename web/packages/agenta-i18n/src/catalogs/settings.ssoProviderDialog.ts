import en from "../../locales/en/settings.ssoProviderDialog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.ssoProviderDialog",
    en,
    (language) => import(`../../locales/${language}/settings.ssoProviderDialog.json`),
)
