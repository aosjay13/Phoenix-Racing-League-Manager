from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class Driver(BaseModel):
    uid: str
    name: str
    number: int
    team: str
    season: int


class DriverCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    number: int = Field(ge=0, le=999)
    team: str = Field(min_length=1, max_length=80)
    season: int = Field(ge=2000, le=2100)


class Race(BaseModel):
    race_id: str
    track: str
    date: date
    season: int
    round_number: int


class RaceCreate(BaseModel):
    track: str = Field(min_length=2, max_length=120)
    date: date
    season: int = Field(ge=2000, le=2100)
    round_number: int = Field(ge=1)


class Result(BaseModel):
    result_id: str
    driver_uid: str
    race_id: str
    finish_pos: int
    laps_led: int = 0
    incidents: int = 0
    status: Literal["finished", "dnf", "dns"] = "finished"
    created_at: datetime


class ResultCreate(BaseModel):
    driver_uid: str
    race_id: str
    finish_pos: int = Field(ge=1, le=99)
    laps_led: int = Field(default=0, ge=0)
    incidents: int = Field(default=0, ge=0)
    status: Literal["finished", "dnf", "dns"] = "finished"


class StandingsRow(BaseModel):
    rank: int
    driver_uid: str
    driver_name: str
    team: str
    points: int
    dropped_points: int
    adjusted_points: int
    wins: int
    top5: int
    avg_finish: float


class StandingsResponse(BaseModel):
    season: int
    drop_weeks: int
    points_scale: dict[int, int]
    rows: list[StandingsRow]
