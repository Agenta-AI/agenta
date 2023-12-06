import {getDefaultNewMessage} from "@/components/ChatInputs/ChatInputs"
import {ChatRole, GenericObject, KeyValuePair} from "../Types"
import {safeParse} from "./utils"
import {v4 as uuidv4} from "uuid"

const isObjectChatMessage = (obj: GenericObject) => {
    return Object.values(ChatRole).includes(obj.role) && typeof obj.content === "string"
}

// TODO: the logic to determine if a testset is chatbase should be improved
/**
 * @returns the key of the column which contains the chat messages, "" if testset is not chat bases
 */
export function getTestsetChatColumn(csvData: KeyValuePair[]) {
    let columnKey = ""
    if (!csvData.length) return columnKey

    const {correct_answer, ...restCols} = csvData[0]
    let isCorrectAnswerChat = false

    // check if correct_answer is a chat message object
    if (correct_answer) {
        const parsedCorrectAnswer = safeParse(correct_answer)
        if (parsedCorrectAnswer && isObjectChatMessage(parsedCorrectAnswer))
            isCorrectAnswerChat = true
    }

    //check if any col other than correct_answer is an array of chat messages
    for (const [key, col] of Object.entries(restCols)) {
        const parsedCol = safeParse(col)
        if (Array.isArray(parsedCol) && parsedCol.every(isObjectChatMessage)) {
            if (isCorrectAnswerChat) {
                columnKey = key
            }
            break
        }
    }

    return columnKey
}

export function testsetRowToChatMessages(rowData: KeyValuePair, includeCorrectAnswer = true) {
    const chatColumn = getTestsetChatColumn([rowData])
    const defaultNewMessage = getDefaultNewMessage()

    if (!chatColumn) return [defaultNewMessage]

    let chat = safeParse(rowData[chatColumn], [])

    if (includeCorrectAnswer) {
        chat = chat.concat([safeParse(rowData.correct_answer, defaultNewMessage)])
    }

    return chat.map((item: KeyValuePair) => ({...item, id: uuidv4()}))
}

export function contentToChatMessageString(content: string, role: ChatRole = ChatRole.Assistant) {
    return JSON.stringify({
        content,
        role,
    })
}
