from uvicorn import run

import app  # pylint: disable=unused-import

import agenta  # pylint: disable=unused-import

if __name__ == "__main__":
    run("agenta:app", host="0.0.0.0", port=8888, reload=True)
