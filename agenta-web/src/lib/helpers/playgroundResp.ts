import {BaseResponse, FuncResponse} from "../Types"

export function isFuncResponse(res: any): res is FuncResponse {
    return res && res?.message
}

export function isBaseResponse(res: any): res is BaseResponse {
    return res && res?.version
}
