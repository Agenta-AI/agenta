import en from "../../locales/en/channels.agentPicker.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.agentPicker",
    en,
    (language) => import(`../../locales/${language}/channels.agentPicker.json`),
)
