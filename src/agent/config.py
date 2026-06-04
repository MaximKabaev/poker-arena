from __future__ import annotations

import json
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CRED_PATH = PROJECT_ROOT / ".arena-credentials"
STYLE_PATH = PROJECT_ROOT / ".arena-style"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    openai_api_key: str = ""
    arena_base_url: str = "https://arena.dev.fun"
    agent_handle: str = ""
    agent_name: str = ""
    agent_quote: str = ""
    competition_id: str = ""
    log_dir: Path = PROJECT_ROOT / "logs"
    db_path: Path = PROJECT_ROOT / "data" / "agent.sqlite"
    llm_model: str = "gpt-5.3"
    llm_budget_seconds: float = 5.0
    safety_budget_seconds: float = 8.0


def load_credentials() -> dict | None:
    if not CRED_PATH.exists():
        return None
    return json.loads(CRED_PATH.read_text())


def save_credentials(creds: dict) -> None:
    CRED_PATH.write_text(json.dumps(creds, indent=2))
    CRED_PATH.chmod(0o600)


def load_style() -> str:
    return STYLE_PATH.read_text() if STYLE_PATH.exists() else ""
