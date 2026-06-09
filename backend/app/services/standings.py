from __future__ import annotations

from collections import defaultdict

import pandas as pd

from app.models import StandingsResponse, StandingsRow


DEFAULT_POINTS_SCALE = {
    1: 40,
    2: 35,
    3: 32,
    4: 30,
    5: 28,
    6: 26,
    7: 24,
    8: 22,
    9: 20,
    10: 18,
    11: 16,
    12: 14,
    13: 12,
    14: 10,
    15: 8,
    16: 6,
    17: 4,
    18: 2,
    19: 1,
    20: 1,
}


def _score_row(finish_pos: int, points_scale: dict[int, int]) -> int:
    return points_scale.get(int(finish_pos), 0)


def calculate_standings(
    results: list[dict],
    drivers: list[dict],
    season: int,
    drop_weeks: int = 0,
    points_scale: dict[int, int] | None = None,
) -> StandingsResponse:
    if points_scale is None:
        points_scale = DEFAULT_POINTS_SCALE

    if not results:
        return StandingsResponse(
            season=season,
            drop_weeks=drop_weeks,
            points_scale=points_scale,
            rows=[],
        )

    drivers_by_uid = {d["uid"]: d for d in drivers}

    df = pd.DataFrame(results)
    df["points"] = df["finish_pos"].apply(lambda p: _score_row(p, points_scale))

    dropped_by_driver = defaultdict(int)
    if drop_weeks > 0:
        for driver_uid, group in df.groupby("driver_uid"):
            sorted_scores = group.sort_values("points", ascending=True)
            dropped = sorted_scores.head(drop_weeks)
            dropped_by_driver[driver_uid] = int(dropped["points"].sum())

    aggregate = (
        df.groupby("driver_uid")
        .agg(
            points=("points", "sum"),
            wins=("finish_pos", lambda s: int((s == 1).sum())),
            top5=("finish_pos", lambda s: int((s <= 5).sum())),
            avg_finish=("finish_pos", "mean"),
        )
        .reset_index()
    )

    aggregate["dropped_points"] = aggregate["driver_uid"].map(dropped_by_driver).fillna(0)
    aggregate["adjusted_points"] = aggregate["points"] - aggregate["dropped_points"]

    # Tie-breakers: adjusted points desc, wins desc, top5 desc, avg finish asc
    aggregate = aggregate.sort_values(
        by=["adjusted_points", "wins", "top5", "avg_finish"],
        ascending=[False, False, False, True],
    ).reset_index(drop=True)

    rows: list[StandingsRow] = []
    for idx, row in aggregate.iterrows():
        driver = drivers_by_uid.get(row["driver_uid"], {})
        rows.append(
            StandingsRow(
                rank=idx + 1,
                driver_uid=row["driver_uid"],
                driver_name=driver.get("name", "Unknown"),
                team=driver.get("team", "Unknown"),
                points=int(row["points"]),
                dropped_points=int(row["dropped_points"]),
                adjusted_points=int(row["adjusted_points"]),
                wins=int(row["wins"]),
                top5=int(row["top5"]),
                avg_finish=round(float(row["avg_finish"]), 2),
            )
        )

    return StandingsResponse(
        season=season,
        drop_weeks=drop_weeks,
        points_scale=points_scale,
        rows=rows,
    )
