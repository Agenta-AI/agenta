import en from "../../locales/en/chat.mobileApproval.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.mobileApproval",
    en,
    (language) => import(`../../locales/${language}/chat.mobileApproval.json`),
)
