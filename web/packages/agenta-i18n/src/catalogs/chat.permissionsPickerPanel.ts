import en from "../../locales/en/chat.permissionsPickerPanel.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "chat.permissionsPickerPanel",
    en,
    (language) => import(`../../locales/${language}/chat.permissionsPickerPanel.json`),
)
