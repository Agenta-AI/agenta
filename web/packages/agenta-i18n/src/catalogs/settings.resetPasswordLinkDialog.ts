import en from "../../locales/en/settings.resetPasswordLinkDialog.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.resetPasswordLinkDialog",
    en,
    (language) => import(`../../locales/${language}/settings.resetPasswordLinkDialog.json`),
)
