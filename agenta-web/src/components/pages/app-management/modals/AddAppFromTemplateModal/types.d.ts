import {Modal} from "antd"
import type {Template} from "@/lib/Types"
import {ServiceType} from "@/services/app-selector/api"

export interface AddAppFromTemplatedModalProps extends React.ComponentProps<typeof Modal> {
    newApp: string
    setNewApp: React.Dispatch<React.SetStateAction<string>>
    templates: Template[]
    noTemplateMessage: string
    onCardClick: (template: Template) => void
    appNameExist: boolean
    templateKey: ServiceType
    handleTemplateCardClick: (template_id: string) => Promise<void>
    fetchingTemplate: boolean
}
