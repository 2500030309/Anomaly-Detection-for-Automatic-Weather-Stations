"""
Layer 4: Spatial Consensus ("Buddy Check")
Performs spatial neighbor cross-comparison to differentiate between
Isolated Sensor Faults and Genuine Mesoscale Weather Events (e.g., Cyclones, Heatwaves).
"""

from typing import Dict, List, Any, Optional
import numpy as np
from backend.engine.physics import haversine_distance
from backend.config import SPATIAL_CONFIG

class Layer4SpatialQC:
    def __init__(self):
        self.max_distance = SPATIAL_CONFIG["max_distance_km"]
        self.min_neighbors = SPATIAL_CONFIG["min_neighbors"]
        self.z_thresh = SPATIAL_CONFIG["z_score_threshold"]
        self.event_ratio = SPATIAL_CONFIG["event_agreement_ratio"]

    def find_neighbors(self, target_station: Dict[str, Any], all_stations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Identifies nearby AWS stations within geographic radius.
        """
        t_lat = target_station["latitude"]
        t_lon = target_station["longitude"]
        t_id = target_station["station_id"]

        neighbors = []
        for s in all_stations:
            if s["station_id"] == t_id:
                continue
            dist = haversine_distance(t_lat, t_lon, s["latitude"], s["longitude"])
            if dist <= self.max_distance:
                s_copy = dict(s)
                s_copy["distance_km"] = dist
                neighbors.append(s_copy)

        # Sort by distance
        neighbors.sort(key=lambda x: x["distance_km"])
        return neighbors

    def evaluate(
        self,
        target_station: Dict[str, Any],
        current_reading: Dict[str, float],
        all_stations: List[Dict[str, Any]],
        all_latest_readings: Dict[str, Dict[str, float]],
        target_history: Optional[List[Dict[str, float]]] = None,
        all_histories: Optional[Dict[str, List[Dict[str, float]]]] = None
    ) -> Dict[str, Any]:
        """
        Runs the Spatial Buddy Check across the AWS network.
        """
        neighbors = self.find_neighbors(target_station, all_stations)
        neighbor_ids = [n["station_id"] for n in neighbors]
        
        # Check if enough neighbors are available
        neighbor_readings = [
            all_latest_readings[nid]
            for nid in neighbor_ids
            if nid in all_latest_readings and all_latest_readings[nid] is not None
        ]

        if len(neighbor_readings) < self.min_neighbors:
            return {
                "passed": True,
                "has_consensus": False,
                "neighbor_count": len(neighbor_readings),
                "neighbors": neighbors,
                "spatial_z_scores": {},
                "is_weather_event": False,
                "weather_event_type": None,
                "details": f"Sparse network coverage: Only {len(neighbor_readings)} buddy station(s) found within {self.max_distance} km. Defaulting to local temporal QC."
            }

        # In meteorology (WMO-No. 8), pressure must be reduced to Mean Sea Level Pressure (MSLP)
        # before spatial neighbor comparison, because pressure naturally varies with elevation.
        t_elev = target_station.get("elevation_m", 0.0)
        t_temp = float(current_reading["temperature"]) if current_reading.get("temperature") is not None else 28.0

        def reduce_to_mslp(p_station: float, elev: float, temp_c: float) -> float:
            tk = temp_c + 273.15
            return p_station * ((1.0 - (0.0065 * elev) / (tk + 0.0065 * elev)) ** -5.257)

        # Spatial Z-score evaluation for each parameter
        z_scores = {}
        spatial_medians = {}
        is_spatial_outlier = False
        outlier_params = []

        for param in ["temperature", "pressure", "humidity"]:
            if param == "pressure":
                cur_p = float(current_reading["pressure"]) if current_reading.get("pressure") is not None else 1013.25
                target_val = reduce_to_mslp(cur_p, t_elev, t_temp)
                n_vals = [
                    reduce_to_mslp(
                        float(all_latest_readings[n["station_id"]]["pressure"]),
                        n.get("elevation_m", 0.0),
                        float(all_latest_readings[n["station_id"]].get("temperature", 28.0))
                    )
                    for n in neighbors
                    if n["station_id"] in all_latest_readings and all_latest_readings[n["station_id"]] is not None and all_latest_readings[n["station_id"]].get("pressure") is not None
                ]
            elif param == "temperature":
                # Elevation lapse rate normalized (~0.65°C per 100m)
                cur_t = float(current_reading["temperature"]) if current_reading.get("temperature") is not None else 28.0
                target_val = cur_t + (t_elev / 100.0) * 0.65
                n_vals = [
                    float(all_latest_readings[n["station_id"]][param]) + (n.get("elevation_m", 0.0) / 100.0) * 0.65
                    for n in neighbors
                    if n["station_id"] in all_latest_readings and all_latest_readings[n["station_id"]] is not None and all_latest_readings[n["station_id"]].get(param) is not None
                ]
            else:
                cur_param = float(current_reading[param]) if current_reading.get(param) is not None else 50.0
                target_val = cur_param
                n_vals = [
                    float(all_latest_readings[n["station_id"]][param])
                    for n in neighbors
                    if n["station_id"] in all_latest_readings and all_latest_readings[n["station_id"]] is not None and all_latest_readings[n["station_id"]].get(param) is not None
                ]
            
            if len(n_vals) >= self.min_neighbors:
                med = float(np.median(n_vals))
                spatial_medians[param] = round(med, 2)
                
                # Robust standard deviation using MAD (Median Absolute Deviation)
                mad = float(np.median([abs(x - med) for x in n_vals]))
                # Minimum noise floor: 1.2°C for T, 1.0 hPa for P, 5% for RH
                noise_floor = 1.2 if param == "temperature" else (1.0 if param == "pressure" else 5.0)
                robust_std = max(mad * 1.4826, noise_floor)
                
                z = (target_val - med) / robust_std
                z_scores[param] = round(z, 2)
                
                if abs(z) >= self.z_thresh:
                    is_spatial_outlier = True
                    outlier_params.append(param)

        # Rate of change spatial coherence check (Key to distinguishing Mesoscale Weather Event vs Sensor Glitch)
        # Check if neighbors ALSO experienced rapid pressure plunge or temperature spike
        is_weather_event = False
        weather_event_type = None

        if target_history and len(target_history) > 0 and all_histories:
            last_target = target_history[-1]
            dt_p = float(current_reading.get("pressure", 1010.0)) - float(last_target.get("pressure", 1010.0))
            dt_t = float(current_reading.get("temperature", 28.0)) - float(last_target.get("temperature", 28.0))

            # Case A: Rapid Barometric Drop (Cyclone / Squall)
            if dt_p < -2.5:
                neighbor_drops = 0
                for nid in neighbor_ids:
                    hist = all_histories.get(nid, [])
                    if hist and len(hist) > 0:
                        cur_p = float(all_latest_readings[nid].get("pressure", 1010.0))
                        # Check if hist[-1] is already current tick
                        if len(hist) >= 2 and hist[-1].get("timestamp") == current_reading.get("timestamp"):
                            prev_p = float(hist[-2].get("pressure", 1010.0))
                        else:
                            prev_p = float(hist[-1].get("pressure", 1010.0))
                        if (cur_p - prev_p) < -2.0:
                            neighbor_drops += 1

                agreement = neighbor_drops / max(1, len(neighbor_readings))
                if agreement >= self.event_ratio:
                    is_weather_event = True
                    weather_event_type = "RAPID_PRESSURE_DROP_CYCLONIC"

            # Case B: Extreme Regional Heatwave
            if float(current_reading.get("temperature", 0.0)) > 43.0:
                high_temp_count = sum(
                    1 for r in neighbor_readings if float(r.get("temperature", 0.0)) > 41.0
                )
                if high_temp_count / max(1, len(neighbor_readings)) >= self.event_ratio:
                    is_weather_event = True
                    weather_event_type = "EXTREME_HEATWAVE"

        return {
            "passed": not is_spatial_outlier or is_weather_event,
            "has_consensus": True,
            "neighbor_count": len(neighbor_readings),
            "neighbors": [
                {
                    "station_id": n["station_id"],
                    "name": n["name"],
                    "distance_km": n["distance_km"]
                }
                for n in neighbors[:5]
            ],
            "spatial_z_scores": z_scores,
            "spatial_medians": spatial_medians,
            "is_spatial_outlier": is_spatial_outlier,
            "outlier_params": outlier_params,
            "is_weather_event": is_weather_event,
            "weather_event_type": weather_event_type,
            "details": (
                f"Mesoscale Weather Event Confirmed ({weather_event_type}): Multi-station spatial consensus validates extreme readings as real atmospheric phenomenon."
                if is_weather_event else
                (
                    f"Spatial discordance detected on {', '.join(outlier_params)} (Z-scores: {z_scores}). Buddy stations do NOT corroborate reading."
                    if is_spatial_outlier else
                    f"Spatial consensus verified across {len(neighbor_readings)} buddy AWS stations (Z-scores within nominal envelope)."
                )
            )
        }
