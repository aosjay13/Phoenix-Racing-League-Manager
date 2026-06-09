from __future__ import annotations

import argparse

import pandas as pd
from firebase_admin import firestore

from database_setup import init_db


def _driver_name_to_uid_map(db: firestore.Client, season: int) -> dict[str, str]:
    docs = db.collection("drivers").where("season", "==", season).stream()
    mapping: dict[str, str] = {}
    for doc in docs:
        data = doc.to_dict()
        mapping[data["name"].strip().lower()] = data["uid"]
    return mapping


def import_results_csv(db: firestore.Client, csv_path: str, season: int) -> tuple[int, list[str]]:
    df = pd.read_csv(csv_path)
    required_cols = {"driver_name", "race_id", "finish_pos", "laps_led", "incidents"}
    missing = required_cols.difference(df.columns)
    if missing:
        raise ValueError(f"Missing required CSV columns: {sorted(missing)}")

    name_map = _driver_name_to_uid_map(db, season)

    unresolved: list[str] = []
    batch = db.batch()
    uploaded = 0

    for _, row in df.iterrows():
        normalized = str(row["driver_name"]).strip().lower()
        driver_uid = name_map.get(normalized)
        if not driver_uid:
            unresolved.append(str(row["driver_name"]))
            continue

        doc_ref = db.collection("results").document()
        batch.set(
            doc_ref,
            {
                "result_id": doc_ref.id,
                "driver_uid": driver_uid,
                "race_id": str(row["race_id"]),
                "finish_pos": int(row["finish_pos"]),
                "laps_led": int(row["laps_led"]),
                "incidents": int(row["incidents"]),
                "status": str(row.get("status", "finished")),
            },
        )
        uploaded += 1

    if uploaded > 0:
        batch.commit()
    return uploaded, sorted(set(unresolved))


def main() -> None:
    parser = argparse.ArgumentParser(description="Import racing results CSV into Firestore")
    parser.add_argument("--service-account", required=True, help="Path to Firebase service account JSON")
    parser.add_argument("--csv", required=True, help="Path to CSV file")
    parser.add_argument("--season", required=True, type=int, help="Season year")
    args = parser.parse_args()

    db = init_db(args.service_account)
    uploaded, unresolved = import_results_csv(db, args.csv, args.season)

    print(f"Uploaded rows: {uploaded}")
    if unresolved:
        print("Unresolved driver names:")
        for name in unresolved:
            print(f" - {name}")


if __name__ == "__main__":
    main()
