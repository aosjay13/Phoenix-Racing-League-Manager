from __future__ import annotations

import os

import firebase_admin
from firebase_admin import credentials, firestore

from app.config import settings


def _build_credentials() -> credentials.Certificate:
    private_key = settings.firebase_private_key.replace("\\n", "\n")
    payload = {
        "type": "service_account",
        "project_id": settings.firebase_project_id,
        "private_key": private_key,
        "client_email": settings.firebase_client_email,
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    return credentials.Certificate(payload)


def _has_valid_inline_service_account() -> bool:
    if not (settings.firebase_project_id and settings.firebase_client_email and settings.firebase_private_key):
        return False

    key = settings.firebase_private_key
    if "YOUR_KEY_HERE" in key:
        return False
    return "BEGIN PRIVATE KEY" in key and "END PRIVATE KEY" in key


def _resolve_service_account_path() -> str:
    explicit = settings.firebase_service_account_path.strip()
    if explicit:
        return explicit
    return os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()


def init_firebase() -> firestore.Client:
    if not firebase_admin._apps:
        service_account_path = _resolve_service_account_path()
        if service_account_path:
            if not os.path.exists(service_account_path):
                raise ValueError(
                    f"Service account JSON not found: {service_account_path}. "
                    "Set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS to a valid file path."
                )
            cred = credentials.Certificate(service_account_path)
            firebase_admin.initialize_app(cred)
        elif _has_valid_inline_service_account():
            cred = _build_credentials()
            firebase_admin.initialize_app(cred)
        else:
            try:
                firebase_admin.initialize_app()
            except Exception as exc:  # pragma: no cover - depends on runtime env
                raise ValueError(
                    "Firebase credentials are not configured. Provide either: "
                    "(1) FIREBASE_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account JSON, "
                    "or (2) valid FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY values in .env."
                ) from exc
    return firestore.client()
