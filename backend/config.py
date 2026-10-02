"""
Configuration and Meteorological QC Thresholds
Based on WMO-No. 8 (Guide to Meteorological Instruments and Methods of Observation)
and IMD (India Meteorological Department) AWS Standards.
"""

from typing import Dict, Any

# Sensor Physical Plausibility Limits (L1 Check)
BOUNDS_CONFIG: Dict[str, Dict[str, float]] = {
    "temperature": {"min": -40.0, "max": 60.0, "unit": "°C"},
    "pressure": {"min": 500.0, "max": 1085.0, "unit": "hPa"},
    "humidity": {"min": 0.0, "max": 100.0, "unit": "%"}
}

# Rate-of-Change / Step Limits (per 15-minute standard IMD transmission interval)
STEP_LIMITS: Dict[str, float] = {
    "temperature": 5.0,   # °C / 15 min
    "pressure": 4.0,      # hPa / 15 min
    "humidity": 30.0      # % / 15 min
}

# Persistence / Flatline Limits (number of identical or near-zero variance steps)
PERSISTENCE_LIMITS: Dict[str, Dict[str, Any]] = {
    "temperature": {"window": 4, "min_std": 0.02},
    "pressure": {"window": 4, "min_std": 0.02},
    "humidity": {"window": 4, "min_std": 0.05}
}

# Magnus-Tetens Dew Point Constants (WMO standard)
MAGNUS_CONSTANTS = {
    "b": 17.27,
    "c": 237.7,     # °C
    "tol": 0.25      # Allowed tolerance: Td can exceed T by at most 0.25°C due to sensor precision
}

# Spatial Buddy Check Configuration (L4)
SPATIAL_CONFIG = {
    "max_distance_km": 120.0,    # Max distance to consider as neighbor AWS
    "min_neighbors": 2,          # Minimum neighbors for high confidence
    "z_score_threshold": 2.5,    # Anomaly Z-score relative to neighbor consensus
    "event_agreement_ratio": 0.6 # Ratio of neighbors that must co-witness an extreme event
}

# Verdict Constants
VERDICT_NORMAL = "NORMAL"
VERDICT_SENSOR_FAULT = "SENSOR_FAULT"
VERDICT_WEATHER_EVENT = "WEATHER_EVENT"
VERDICT_UNCERTAIN = "UNCERTAIN"

# Sensor Fault Subtypes
FAULT_SPIKE = "SPIKE"
FAULT_STUCK = "STUCK_FLATLINE"
FAULT_DRIFT = "CALIBRATION_DRIFT"
FAULT_OUT_OF_BOUNDS = "OUT_OF_BOUNDS"
FAULT_DROPOUT = "COMM_DROPOUT"
FAULT_UNPHYSICAL = "PHYSICS_VIOLATION"

# Weather Event Subtypes
EVENT_CYCLONIC_DROP = "RAPID_PRESSURE_DROP_CYCLONIC"
EVENT_HEATWAVE = "EXTREME_HEATWAVE"
EVENT_SQUALL = "THUNDERSTORM_SQUALL"
EVENT_COLD_SNAP = "RAPID_COLD_FRONT"
