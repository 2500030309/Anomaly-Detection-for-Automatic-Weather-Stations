"""
Pydantic Data Models for FastAPI Endpoints
"""

from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field

class TelemetryInput(BaseModel):
    station_id: str
    temperature: Optional[float] = Field(None, description="Ambient Temperature in °C")
    pressure: Optional[float] = Field(None, description="Atmospheric Pressure in hPa")
    humidity: Optional[float] = Field(None, description="Relative Humidity in %")
    timestamp: Optional[str] = None

class ScenarioInjectionRequest(BaseModel):
    scenario_type: str = Field(..., description="SPIKE, STUCK, DRIFT, PHYSICS_VIOLATION, DROPOUT, OUT_OF_BOUNDS, CYCLONIC_EVENT, HEATWAVE, RESET")
    target_station_id: Optional[str] = None
    duration_ticks: int = Field(8, description="Number of 15-minute simulation steps")
    custom_params: Optional[Dict[str, Any]] = None

class StationInfo(BaseModel):
    station_id: str
    name: str
    code: str
    latitude: float
    longitude: float
    elevation_m: float
    district: str
    state: str
    sensors: List[str]
