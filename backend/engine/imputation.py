"""
Automated Data Imputation & Self-Healing Engine
Reconstructs corrupted, missing, or unphysical sensor readings using
Spatial Inverse Distance Weighting (IDW) + Hypsometric Reduction + Magnus-Tetens Invariants.
Assigns International WMO QC Flags (0=Good, 1=Suspect, 2=Healed/Imputed, 3=Severe Weather).
"""

from typing import Dict, List, Any, Tuple
import numpy as np
from backend.engine.physics import haversine_distance, compute_dew_point

# International WMO-No. 8 Operational Quality Control Flags
WMO_FLAG_GOOD = 0             # Observation passed all QC checks
WMO_FLAG_SUSPECT = 1          # Observation suspect/inconclusive
WMO_FLAG_HEALED = 2           # Erroneous sensor reading replaced with healed imputation
WMO_FLAG_WEATHER_EVENT = 3    # Extreme reading verified as authentic mesoscale weather

class DataImputer:
    def __init__(self, max_distance_km: float = 140.0):
        self.max_distance = max_distance_km

    def reduce_to_mslp(self, p_station: float, elev: float, temp_c: float) -> float:
        tk = temp_c + 273.15
        return p_station * ((1.0 - (0.0065 * elev) / (tk + 0.0065 * elev)) ** -5.257)

    def mslp_to_station_pressure(self, p_mslp: float, elev: float, temp_c: float) -> float:
        tk = temp_c + 273.15
        return p_mslp * ((1.0 - (0.0065 * elev) / (tk + 0.0065 * elev)) ** 5.257)

    def heal_reading(
        self,
        target_station: Dict[str, Any],
        raw_reading: Dict[str, Any],
        verdict: str,
        violations: Dict[str, Any],
        all_stations: List[Dict[str, Any]],
        all_latest_readings: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Takes raw telemetry reading and verdict, producing a self-healed observation.
        """
        t_id = target_station["station_id"]
        t_lat = target_station["latitude"]
        t_lon = target_station["longitude"]
        t_elev = target_station.get("elevation_m", 15.0)

        healed = dict(raw_reading)
        flags = {
            "temperature": WMO_FLAG_GOOD,
            "pressure": WMO_FLAG_GOOD,
            "humidity": WMO_FLAG_GOOD
        }
        healed_params = []

        # If observation is clean, return as-is
        if verdict == "NORMAL":
            return {
                "is_healed": False,
                "reading": healed,
                "healed_params": [],
                "qc_flags": flags,
                "confidence": 1.0,
                "method": "RAW_VERIFIED"
            }

        if verdict == "WEATHER_EVENT":
            # Genuine extreme weather: do NOT impute, tag with WMO Severe Weather flag
            return {
                "is_healed": False,
                "reading": healed,
                "healed_params": [],
                "qc_flags": {
                    "temperature": WMO_FLAG_WEATHER_EVENT,
                    "pressure": WMO_FLAG_WEATHER_EVENT,
                    "humidity": WMO_FLAG_WEATHER_EVENT
                },
                "confidence": 0.98,
                "method": "PRESERVED_WEATHER_EXTREME"
            }

        # SENSOR_FAULT or UNCERTAIN: compute spatial IDW consensus estimates
        neighbor_data = []
        for s in all_stations:
            nid = s["station_id"]
            if nid == t_id:
                continue
            nr = all_latest_readings.get(nid)
            if not nr or nr.get("temperature") is None or nr.get("pressure") is None:
                continue

            dist = haversine_distance(t_lat, t_lon, s["latitude"], s["longitude"])
            if dist <= self.max_distance:
                weight = 1.0 / max(dist ** 2, 1.0)
                n_elev = s.get("elevation_m", 15.0)
                n_temp = float(nr["temperature"])
                n_pres = float(nr["pressure"])
                n_rh = float(nr.get("humidity", 65.0))

                # Normalize to sea level for spatial weighting
                n_slp = self.reduce_to_mslp(n_pres, n_elev, n_temp)
                n_temp_sl = n_temp + (n_elev / 100.0) * 0.65

                neighbor_data.append({
                    "weight": weight,
                    "temp_sl": n_temp_sl,
                    "slp": n_slp,
                    "rh": n_rh
                })

        if not neighbor_data:
            # Fallback to standard diurnal climatological baseline for target elevation
            est_temp = round(28.5 - (t_elev / 100.0) * 0.65, 2)
            est_pres = round(1013.25 - (t_elev / 8.5), 2)
            est_rh = 65.0
            confidence = 0.70
            method = "CLIMATOLOGICAL_BASELINE_FALLBACK"
        else:
            # Compute IDW weighted averages
            sum_w = sum(d["weight"] for d in neighbor_data)
            idw_temp_sl = sum(d["weight"] * d["temp_sl"] for d in neighbor_data) / sum_w
            idw_slp = sum(d["weight"] * d["slp"] for d in neighbor_data) / sum_w
            idw_rh = sum(d["weight"] * d["rh"] for d in neighbor_data) / sum_w

            # Adjust back to target station elevation
            est_temp = round(idw_temp_sl - (t_elev / 100.0) * 0.65, 2)
            est_pres = round(self.mslp_to_station_pressure(idw_slp, t_elev, est_temp), 2)
            est_rh = round(float(np.clip(idw_rh, 15.0, 98.0)), 1)
            confidence = round(float(min(0.96, 0.70 + 0.05 * len(neighbor_data))), 2)
            method = "SPATIAL_IDW_PHYSICS_FUSION"

        # Decide which specific sensors require healing
        raw_t = raw_reading.get("temperature")
        raw_p = raw_reading.get("pressure")
        raw_rh = raw_reading.get("humidity")

        # Temperature healing
        if raw_t is None or "temperature" in violations or raw_t < -40 or raw_t > 60:
            healed["temperature"] = est_temp
            flags["temperature"] = WMO_FLAG_HEALED
            healed_params.append("temperature")

        # Pressure healing
        if raw_p is None or "pressure" in violations or raw_p < 500 or raw_p > 1085:
            healed["pressure"] = est_pres
            flags["pressure"] = WMO_FLAG_HEALED
            healed_params.append("pressure")

        # Humidity healing
        if raw_rh is None or "humidity" in violations or raw_rh < 0 or raw_rh > 100:
            healed["humidity"] = est_rh
            flags["humidity"] = WMO_FLAG_HEALED
            healed_params.append("humidity")

        # Enforce thermodynamic invariant on healed values (Td <= T)
        final_t = healed["temperature"]
        final_rh = healed["humidity"]
        final_td = compute_dew_point(final_t, final_rh)

        if final_td > final_t:
            # Rebalance RH so Td equals T (saturation limit)
            healed["humidity"] = 99.0
            final_td = compute_dew_point(final_t, 99.0)
            flags["humidity"] = WMO_FLAG_HEALED
            if "humidity" not in healed_params:
                healed_params.append("humidity")

        healed["dew_point"] = final_td

        return {
            "is_healed": len(healed_params) > 0,
            "reading": healed,
            "healed_params": healed_params,
            "qc_flags": flags,
            "confidence": round(float(min(0.96, 0.70 + 0.05 * len(neighbor_data))), 2),
            "method": "SPATIAL_IDW_PHYSICS_FUSION"
        }
