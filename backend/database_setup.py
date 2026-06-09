from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import firebase_admin
from firebase_admin import credentials, firestore


def init_db(service_account_json_path: str) -> firestore.Client:
    if not firebase_admin._apps:
        cred = credentials.Certificate(service_account_json_path)
        firebase_admin.initialize_app(cred)
    return firestore.client()


def get_all_drivers(db: firestore.Client, season: int) -> list[dict]:
    docs = db.collection("drivers").where("season", "==", season).stream()
    return [doc.to_dict() for doc in docs]


def add_race_result(
    db: firestore.Client,
    driver_uid: str,
    race_id: str,
    finish_pos: int,
    laps_led: int,
    incidents: int,
    status: str = "finished",
) -> dict:
    result_id = str(uuid4())
    payload = {
        "result_id": result_id,
        "driver_uid": driver_uid,
        "race_id": race_id,
        "finish_pos": finish_pos,
        "laps_led": laps_led,
        "incidents": incidents,
        "status": status,
        "created_at": datetime.now(timezone.utc),
    }
    db.collection("results").document(result_id).set(payload)
    return payload


def get_season_results(db: firestore.Client, season: int) -> list[dict]:
    race_docs = db.collection("races").where("season", "==", season).stream()
    race_ids = [doc.to_dict()["race_id"] for doc in race_docs]

    season_results: list[dict] = []
    for race_id in race_ids:
        docs = db.collection("results").where("race_id", "==", race_id).stream()
        season_results.extend([doc.to_dict() for doc in docs])
    return season_results
