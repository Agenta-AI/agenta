from fastapi import FastAPI
import supertokens_python


def extend_main(app: FastAPI):
    app.add_middleware(supertokens_python.framework.fastapi.get_middleware())
    allow_headers = ["Content-Type"] + supertokens_python.get_all_cors_headers()
    return app, allow_headers
