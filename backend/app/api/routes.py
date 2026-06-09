from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.models import DriverCreate, RaceCreate, ResultCreate, StandingsResponse
from app.repositories import DriverRepository, RaceRepository, ResultRepository
from app.services.standings import DEFAULT_POINTS_SCALE, calculate_standings


router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/drivers")
def add_driver(payload: DriverCreate) -> dict:
    return DriverRepository.add(payload)


@router.get("/drivers")
def get_drivers(season: int = Query(..., ge=2000, le=2100)) -> list[dict]:
    return DriverRepository.all_for_season(season)


@router.put("/drivers/{uid}")
def update_driver(uid: str, payload: DriverCreate) -> dict:
    updated = DriverRepository.update(uid, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    return updated


@router.delete("/drivers/{uid}")
def delete_driver(uid: str) -> dict[str, bool]:
    deleted = DriverRepository.delete(uid)
    if not deleted:
        raise HTTPException(status_code=404, detail="Driver not found")
    return {"deleted": True}


@router.post("/races")
def add_race(payload: RaceCreate) -> dict:
    return RaceRepository.add(payload)


@router.get("/races")
def get_races(season: int = Query(..., ge=2000, le=2100)) -> list[dict]:
    return RaceRepository.all_for_season(season)


@router.post("/results")
def add_result(payload: ResultCreate) -> dict:
    try:
        return ResultRepository.add(payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/standings", response_model=StandingsResponse)
def get_standings(
    season: int = Query(..., ge=2000, le=2100),
    drop_weeks: int = Query(0, ge=0, le=10),
) -> StandingsResponse:
    drivers = DriverRepository.all_for_season(season)
    results = ResultRepository.all_for_season(season)
    return calculate_standings(
        results=results,
        drivers=drivers,
        season=season,
        drop_weeks=drop_weeks,
        points_scale=DEFAULT_POINTS_SCALE,
    )
