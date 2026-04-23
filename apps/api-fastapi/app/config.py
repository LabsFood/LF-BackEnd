from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: str = Field(default="development", alias="ENVIRONMENT")
    debug: bool = Field(default=True, alias="DEBUG")
    api_host: str = Field(default="0.0.0.0", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")

    database_url: str = Field(alias="DATABASE_URL")
    redis_url: str = Field(alias="REDIS_URL")

    clerk_secret_key: str | None = Field(default=None, alias="CLERK_SECRET_KEY")
    clerk_webhook_signing_secret: str | None = Field(
        default=None, alias="CLERK_WEBHOOK_SIGNING_SECRET"
    )

    stripe_secret_key: str | None = Field(default=None, alias="STRIPE_SECRET_KEY")
    stripe_webhook_secret: str | None = Field(default=None, alias="STRIPE_WEBHOOK_SECRET")

    cronofy_client_id: str | None = Field(default=None, alias="CRONOFY_CLIENT_ID")
    cronofy_client_secret: str | None = Field(default=None, alias="CRONOFY_CLIENT_SECRET")
    cronofy_data_center: str = Field(default="us", alias="CRONOFY_DATA_CENTER")

    stream_api_key: str | None = Field(default=None, alias="STREAM_API_KEY")
    stream_api_secret: str | None = Field(default=None, alias="STREAM_API_SECRET")
    stream_app_id: str | None = Field(default=None, alias="STREAM_APP_ID")

    brevo_api_key: str | None = Field(default=None, alias="BREVO_API_KEY")
    brevo_sender_email: str = Field(
        default="noreply@example.com", alias="BREVO_SENDER_EMAIL"
    )
    brevo_sender_name: str = Field(default="Labs Food", alias="BREVO_SENDER_NAME")

    google_maps_api_key: str | None = Field(default=None, alias="GOOGLE_MAPS_API_KEY")

    aws_access_key_id: str | None = Field(default=None, alias="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str | None = Field(default=None, alias="AWS_SECRET_ACCESS_KEY")
    aws_region: str = Field(default="eu-west-3", alias="AWS_REGION")
    aws_s3_bucket: str | None = Field(default=None, alias="AWS_S3_BUCKET")

    cors_origins_raw: str = Field(
        default="http://localhost:3000", alias="CORS_ORIGINS"
    )

    @property
    def cors_origins(self) -> List[str]:
        """Parse CORS_ORIGINS env string into a clean list of allowed origins."""
        return [o.strip() for o in self.cors_origins_raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return process-wide Settings, cached so env is parsed only once."""
    return Settings()
