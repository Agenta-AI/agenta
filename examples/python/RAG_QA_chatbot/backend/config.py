"""Configuration settings from environment variables."""

import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Settings loaded from environment variables."""

    # Qdrant
    QDRANT_URL: str = os.getenv("QDRANT_URL", "")
    QDRANT_API_KEY: str = os.getenv("QDRANT_API_KEY", "")
    COLLECTION_NAME: str = os.getenv("COLLECTION_NAME", "docs_collection")

    # Models
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "openai")  # openai or cohere
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gpt-4o-mini")

    # RAG settings
    TOP_K: int = int(os.getenv("TOP_K", "10"))

    # Agenta observability
    AGENTA_API_KEY: str = os.getenv("AGENTA_API_KEY", "")
    AGENTA_HOST: str = os.getenv("AGENTA_HOST", "https://cloud.agenta.ai")


settings = Settings()
