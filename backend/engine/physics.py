"""
Meteorological Physics Formulas and Calculations
Implements Magnus-Tetens Dew Point, Vapor Pressure, and Thermodynamic Laws.
Reference: Lawrence (2005), WMO-No. 8.
"""

import math
from typing import Tuple, Dict, Any, Optional
from backend.config import MAGNUS_CONSTANTS

def compute_dew_point(temp_c: Optional[float], humidity: Optional[float]) -> Optional[float]:
    """
    Computes Dew Point (Td in °C) using the Magnus-Tetens formula.
    Valid for T between -45°C and 60°C, RH between 1% and 100%.
    """
    if temp_c is None or humidity is None:
        return None
    try:
        temp_c = float(temp_c)
        humidity = float(humidity)
    except (ValueError, TypeError):
        return None

    if math.isnan(temp_c) or math.isnan(humidity):
        return None

    if humidity <= 0.0:
        return -50.0  # Cap extreme dry limit
    if humidity > 100.0:
        humidity = 100.0

    b = MAGNUS_CONSTANTS["b"]
    c = MAGNUS_CONSTANTS["c"]

    denom_temp = c + temp_c
    if abs(denom_temp) < 1e-6:
        return -50.0

    # Intermediate factor gamma
    gamma = (b * temp_c) / denom_temp + math.log(humidity / 100.0)
    
    denom_gamma = b - gamma
    if abs(denom_gamma) < 1e-6:
        return round(temp_c, 2)

    # Dew point formula
    td = (c * gamma) / denom_gamma
    return round(td, 2)

def compute_vapor_pressure(temp_c: Optional[float], humidity: Optional[float]) -> Tuple[float, float]:
    """
    Computes actual vapor pressure (e) and saturation vapor pressure (es) in hPa.
    Tetens equation: es(T) = 6.1078 * exp( (17.27 * T) / (T + 237.3) )
    """
    if temp_c is None or humidity is None:
        return 0.0, 0.0
    try:
        temp_c = float(temp_c)
        humidity = float(humidity)
    except (ValueError, TypeError):
        return 0.0, 0.0

    if math.isnan(temp_c) or math.isnan(humidity):
        return 0.0, 0.0

    denom = temp_c + 237.3
    if abs(denom) < 1e-6:
        return 0.0, 0.0

    es = 6.1078 * math.exp((17.27 * temp_c) / denom)
    e = es * (max(0.0, min(100.0, humidity)) / 100.0)
    return round(e, 2), round(es, 2)

def check_thermodynamic_consistency(temp_c: Optional[float], humidity: Optional[float]) -> Dict[str, Any]:
    """
    Verifies that the Dew Point does not physically exceed the ambient Temperature.
    Thermodynamic Law: Air cannot cool past saturation without precipitating/condensing.
    Td <= T is an invariant of atmospheric physics. RH > 100% in free air is unphysical.
    """
    if temp_c is None or humidity is None:
        return {
            "dew_point": None,
            "temperature": temp_c,
            "humidity": humidity,
            "actual_vapor_pressure": 0.0,
            "sat_vapor_pressure": 0.0,
            "is_valid": False,
            "exceedance": 0.0,
            "explanation": "Missing or null temperature / humidity reading."
        }
    try:
        temp_c = float(temp_c)
        humidity = float(humidity)
    except (ValueError, TypeError):
        return {
            "dew_point": None,
            "temperature": temp_c,
            "humidity": humidity,
            "actual_vapor_pressure": 0.0,
            "sat_vapor_pressure": 0.0,
            "is_valid": False,
            "exceedance": 0.0,
            "explanation": "Invalid non-numeric telemetry values."
        }

    if humidity > 100.0:
        exceed = round(humidity - 100.0, 1)
        return {
            "dew_point": round(temp_c + (exceed * 0.2), 2),
            "temperature": temp_c,
            "humidity": humidity,
            "actual_vapor_pressure": 0.0,
            "sat_vapor_pressure": 0.0,
            "is_valid": False,
            "exceedance": exceed,
            "explanation": f"Thermodynamic Invariant Violated: Relative Humidity ({humidity}%) exceeds 100% physical saturation limit."
        }

    td = compute_dew_point(temp_c, humidity)
    if td is None:
        td = temp_c

    tol = MAGNUS_CONSTANTS["tol"]
    
    # Violation if Td > T + tolerance
    violation = td > (temp_c + tol)
    exceedance = max(0.0, td - temp_c)
    
    e, es = compute_vapor_pressure(temp_c, humidity)

    return {
        "dew_point": td,
        "temperature": temp_c,
        "humidity": humidity,
        "actual_vapor_pressure": e,
        "sat_vapor_pressure": es,
        "is_valid": not violation,
        "exceedance": round(exceedance, 2),
        "explanation": (
            f"Thermodynamic Invariant Violated: Dew Point ({td}°C) exceeds ambient temperature ({temp_c}°C) "
            f"by {round(exceedance, 2)}°C. Unphysical supersaturation indicates relative humidity or temperature sensor failure."
            if violation else
            f"Dew Point ({td}°C) physically consistent with ambient temperature ({temp_c}°C)."
        )
    }

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculates great-circle distance between two GPS coordinates in kilometers.
    """
    R = 6371.0 # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2.0) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2)
    a = max(0.0, min(1.0, a))  # Guard against float rounding exceeding 1.0
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)
