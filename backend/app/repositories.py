from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.firebase import init_firebase
from app.models import DriverCreate, RaceCreate, ResultCreate


db = init_firebase()


class DriverRepository:
    collection = "drivers"

    @classmethod
    def all_for_season(cls, season: int) -> list[dict[str, Any]]:
        docs = db.collection(cls.collection).where("season", "==", season).stream()
        return [doc.to_dict() for doc in docs]

    @classmethod
    def add(cls, payload: DriverCreate) -> dict[str, Any]:
        uid = str(uuid4())
        doc = {"uid": uid, **payload.model_dump()}
        db.collection(cls.collection).document(uid).set(doc)
        return doc

    @classmethod
    def get_by_uid(cls, uid: str) -> dict[str, Any] | None:
        doc = db.collection(cls.collection).document(uid).get()
        if not doc.exists:
            return None
        return doc.to_dict()

    @classmethod
    def update(cls, uid: str, payload: DriverCreate) -> dict[str, Any] | None:
        existing = cls.get_by_uid(uid)
        if existing is None:
            return None
        updated = {"uid": uid, **payload.model_dump()}
        db.collection(cls.collection).document(uid).set(updated)
        return updated

    @classmethod
    def delete(cls, uid: str) -> bool:
        existing = cls.get_by_uid(uid)
        if existing is None:
            return False
        db.collection(cls.collection).document(uid).delete()
        return True


class RaceRepository:
    collection = "races"

    @classmethod
    def all_for_season(cls, season: int) -> list[dict[str, Any]]:
        docs = db.collection(cls.collection).where("season", "==", season).stream()
        return [doc.to_dict() for doc in docs]

    @classmethod
    def add(cls, payload: RaceCreate) -> dict[str, Any]:
        race_id = str(uuid4())
        data = payload.model_dump()
        data["date"] = str(data["date"])
        doc = {"race_id": race_id, **data}
        db.collection(cls.collection).document(race_id).set(doc)
        return doc


class ResultRepository:
    collection = "results"

    @classmethod
    def add(cls, payload: ResultCreate) -> dict[str, Any]:
        result_id = str(uuid4())
        existing = (
            db.collection(cls.collection)
            .where("race_id", "==", payload.race_id)
            .where("driver_uid", "==", payload.driver_uid)
            .limit(1)
            .stream()
        )
        if any(existing):
            raise ValueError("Result already exists for this driver and race")

        doc = {
            "result_id": result_id,
            **payload.model_dump(),
            "created_at": datetime.now(timezone.utc),
        }
        db.collection(cls.collection).document(result_id).set(doc)
        return doc

    @classmethod
    def all_for_season(cls, season: int) -> list[dict[str, Any]]:
        race_docs = db.collection("races").where("season", "==", season).stream()
        race_ids = [doc.to_dict()["race_id"] for doc in race_docs]

        if not race_ids:
            return []

        all_results: list[dict[str, Any]] = []
        for race_id in race_ids:
            docs = db.collection(cls.collection).where("race_id", "==", race_id).stream()
            all_results.extend([doc.to_dict() for doc in docs])
        return all_results
