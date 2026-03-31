from uvicorn import run


if __name__ == "__main__":
    run("agenta:app", host="0.0.0.0", port=8888, reload=True)
