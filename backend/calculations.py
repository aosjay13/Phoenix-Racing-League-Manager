from __future__ import annotations

import pandas as pd

POINTS_SCALE = {
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


def calculate_standings(results: list[dict], drop_weeks: int = 0) -> pd.DataFrame:
    if not results:
        return pd.DataFrame(
            columns=["driver_uid", "points", "wins", "top5", "dropped_points", "adjusted_points", "avg_finish"]
        )

    df = pd.DataFrame(results)
    df["points"] = df["finish_pos"].map(lambda pos: POINTS_SCALE.get(int(pos), 0))

    dropped = pd.Series(0, index=df["driver_uid"].unique(), dtype="int64")
    if drop_weeks > 0:
        for driver_uid, group in df.groupby("driver_uid"):
            dropped.loc[driver_uid] = int(group.sort_values("points", ascending=True).head(drop_weeks)["points"].sum())

    standings = (
        df.groupby("driver_uid")
        .agg(
            points=("points", "sum"),
            wins=("finish_pos", lambda s: int((s == 1).sum())),
            top5=("finish_pos", lambda s: int((s <= 5).sum())),
            avg_finish=("finish_pos", "mean"),
        )
        .reset_index()
    )

    standings["dropped_points"] = standings["driver_uid"].map(dropped).fillna(0).astype(int)
    standings["adjusted_points"] = standings["points"] - standings["dropped_points"]

    standings = standings.sort_values(
        by=["adjusted_points", "wins", "top5", "avg_finish"],
        ascending=[False, False, False, True],
    ).reset_index(drop=True)

    standings["rank"] = standings.index + 1
    return standings
