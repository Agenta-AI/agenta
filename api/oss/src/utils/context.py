from contextvars import ContextVar

request_id_ctx: ContextVar[str] = ContextVar("request_id", default=None)
