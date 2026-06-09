from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    firebase_service_account_path: str = ""
    firebase_project_id: str = ""
    firebase_client_email: str = ""
    firebase_private_key: str = ""


settings = Settings()
