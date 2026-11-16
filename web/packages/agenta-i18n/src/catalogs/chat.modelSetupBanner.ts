import en from "../../locales/en/chat.modelSetupBanner.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.modelSetupBanner",
    en,
    (language) => import(`../../locales/${language}/chat.modelSetupBanner.json`),
)
