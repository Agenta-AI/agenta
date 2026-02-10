from uvicorn import run

try:
    import ingest
except ImportError:
    pass


if __name__ == "__main__":
    run("agenta:app", host="0.0.0.0", port=800, reload=True)
