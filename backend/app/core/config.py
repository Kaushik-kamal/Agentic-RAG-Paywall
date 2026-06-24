from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_name: str = "Agentic RAG Paywall"
    debug: bool = False
    api_version: str = "v1"

    # Gemini
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # ChromaDB
    chroma_host: str = "localhost"
    chroma_port: int = 8001
    chroma_collection: str = "knowledge_base"
    chroma_persist_dir: str = "./data/chroma"

    # Stellar
    stellar_network: str = "testnet"  # "testnet" or "mainnet"
    stellar_horizon_url: str = "https://horizon-testnet.stellar.org"
    stellar_secret_key: str = ""
    stellar_public_key: str = ""
    x402_price_xlm: float = 0.01

    # JWT / Auth
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60

    # LangChain
    langchain_api_key: str = ""
    langchain_tracing: bool = False

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
