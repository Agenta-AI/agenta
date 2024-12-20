import type {BaseResponse, ValidationError} from "./openApiJsonTypes"
import type {AgentaConfig} from "./parsedSchema"

// Common response types
interface ValidationErrorResponse {
    description: "Validation Error"
    content: {
        "application/json": {
            schema: {
                properties: {
                    detail: {
                        items: ValidationError
                        type: "array"
                        title: "Detail"
                    }
                }
                type: "object"
                title: "HTTPValidationError"
            }
        }
    }
}

// Request body types
interface BaseRequestBody {
    inputs: {
        title: "Inputs"
    }
}

interface RequestBodyWithConfig extends BaseRequestBody {
    agenta_config: AgentaConfig
}

// Path operation types
interface PathOperation {
    summary: "Generate"
    responses: {
        "200": {
            description: "Successful Response"
            content: {
                "application/json": {
                    schema: BaseResponse
                }
            }
        }
        "422": ValidationErrorResponse
    }
}

interface PostOperation extends PathOperation {
    requestBody: {
        content: {
            "application/json": {
                schema: BaseRequestBody | RequestBodyWithConfig
            }
        }
        required: true
    }
}

// OpenAPI Specification
export interface OpenAPISpec {
    openapi: string
    info: {
        title: string
        version: string
    }
    paths: {
        "/health": {
            get: {
                summary: "Health"
                operationId: "health_health_get"
                responses: {
                    "200": {
                        description: "Successful Response"
                        content: {
                            "application/json": {
                                schema: {}
                            }
                        }
                    }
                }
            }
        }
        "/run": {
            post: PostOperation & {
                operationId: "generate_run_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: BaseRequestBody
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_run_post"
                            }
                        }
                    }
                }
            }
        }
        "/generate": {
            post: PostOperation & {
                operationId: "generate_generate_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: RequestBodyWithConfig
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_generate_post"
                            }
                        }
                    }
                }
            }
        }
        "/generate_deployed": {
            post: PostOperation & {
                operationId: "generate_generate_deployed_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: BaseRequestBody
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_generate_deployed_post"
                            }
                        }
                    }
                }
            }
        }
        "/test": {
            post: PostOperation & {
                operationId: "generate_test_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: RequestBodyWithConfig
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_test_post"
                            }
                        }
                    }
                }
            }
        }
        "/playground/run": {
            post: PostOperation & {
                operationId: "generate_playground_run_post"
                requestBody: {
                    content: {
                        "application/json": {
                            schema: {
                                properties: RequestBodyWithConfig
                                type: "object"
                                required: ["inputs"]
                                title: "Body_generate_playground_run_post"
                            }
                        }
                    }
                }
            }
        }
    }
    components: {
        schemas: {
            AgentaNodesResponse: {}
            BaseResponse: BaseResponse
            Body_generate_generate_deployed_post: BaseRequestBody
            Body_generate_generate_post: RequestBodyWithConfig
            Body_generate_playground_run_post: RequestBodyWithConfig
            Body_generate_run_post: BaseRequestBody
            Body_generate_test_post: RequestBodyWithConfig
            ExceptionDto: {}
            HTTPValidationError: ValidationErrorResponse["content"]["application/json"]["schema"]
            ValidationError: ValidationError
        }
    }
}

export type {
    ValidationErrorResponse,
    BaseRequestBody,
    RequestBodyWithConfig,
    PathOperation,
    PostOperation,
}
