"""
AWS Real-Time Telemetry Simulator & Fault/Weather Injection Engine
Generates authentic meteorological cycles and allows live interactive injection of
sensor faults vs. genuine mesoscale weather events for demonstration.
"""

import json
import math
import random
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from backend.engine.physics import compute_dew_point

class AWSSimulator:
    def __init__(self, stations_file: str = "data/sample_stations.json"):
        with open(stations_file, "r") as f:
            self.stations: List[Dict[str, Any]] = json.load(f)
            
        self.step_index = 0
        self.simulated_time = datetime(2026, 10, 1, 10, 0, 0)
        
        # In-memory storage for rolling historical telemetry
        self.history: Dict[str, List[Dict[str, Any]]] = {
            s["station_id"]: [] for s in self.stations
        }
        self.latest_readings: Dict[str, Dict[str, Any]] = {}
        self.latest_evaluations: Dict[str, Dict[str, Any]] = {}
        self.past_verdicts: Dict[str, List[str]] = {
            s["station_id"]: [] for s in self.stations
        }

        # Active injected scenarios
        # station_id -> { "type": ..., "param": ..., "magnitude": ..., "remaining_ticks": ... }
        self.active_injections: Dict[str, Dict[str, Any]] = {}
        self.global_scenario: Optional[str] = None # e.g. "CYCLONIC_EVENT", "HEATWAVE"
        self.global_scenario_ticks = 0

        # Prepopulate with 24 past 15-minute readings to build realistic history
        self._prepopulate_history()

    def _prepopulate_history(self, num_steps: int = 24):
        """Pre-seeds history with clean diurnal meteorological data."""
        start_time = self.simulated_time - timedelta(minutes=15 * num_steps)
        for i in range(num_steps):
            t_now = start_time + timedelta(minutes=15 * i)
            for station in self.stations:
                sid = station["station_id"]
                reading = self._generate_base_reading(station, t_now, noise_factor=0.3)
                self.history[sid].append(reading)
                self.past_verdicts[sid].append("NORMAL")
                self.latest_readings[sid] = reading

    def _generate_base_reading(
        self,
        station: Dict[str, Any],
        sim_time: datetime,
        noise_factor: float = 0.5
    ) -> Dict[str, Any]:
        """
        Generates realistic baseline weather data based on diurnal cycle and elevation.
        """
        hour = sim_time.hour + (sim_time.minute / 60.0)
        elev = station.get("elevation_m", 15.0)

        # Diurnal temperature cycle: peak around 14:00, trough around 05:30
        diurnal_angle = 2.0 * math.pi * ((hour - 9.0) / 24.0)
        base_temp = 29.0 + 5.5 * math.sin(diurnal_angle)
        # Elevation lapse rate: ~0.65°C per 100m
        base_temp -= (elev / 100.0) * 0.65
        temp = base_temp + random.gauss(0, 0.25 * noise_factor)

        # Diurnal pressure cycle (semi-diurnal barometric tide ~ 1012 hPa)
        # Atmospheric pressure drops with elevation: ~1 hPa per 8.5m
        base_pressure = 1013.25 - (elev / 8.5)
        # Semi-diurnal oscillation (peaks at 10:00 and 22:00)
        p_tide = 1.2 * math.cos(4.0 * math.pi * (hour / 24.0))
        pressure = base_pressure + p_tide + random.gauss(0, 0.2 * noise_factor)

        # Relative humidity: inversely related to temperature
        base_rh = 72.0 - 18.0 * math.sin(diurnal_angle)
        # Coastal stations get higher baseline humidity
        if station.get("elevation_m", 10.0) < 10.0:
            base_rh += 6.0
        humidity = max(25.0, min(95.0, base_rh + random.gauss(0, 1.2 * noise_factor)))

        temp = round(temp, 2)
        pressure = round(pressure, 2)
        humidity = round(humidity, 1)
        dew_point = compute_dew_point(temp, humidity)

        return {
            "timestamp": sim_time.isoformat(),
            "station_id": station["station_id"],
            "temperature": temp,
            "pressure": pressure,
            "humidity": humidity,
            "dew_point": dew_point
        }

    def inject_scenario(
        self,
        scenario_type: str,
        target_station_id: Optional[str] = None,
        duration_ticks: int = 8,
        custom_params: Optional[Dict[str, Any]] = None
    ):
        """
        Injects a synthetic fault or mesoscale weather event.
        Types:
        - "SPIKE": Rapid spike on target station
        - "STUCK": Flatline frozen sensor on target station
        - "DRIFT": Progressive sensor drift
        - "PHYSICS_VIOLATION": Unphysical high humidity (Td > T)
        - "DROPOUT": Missing data / NaN
        - "CYCLONIC_EVENT": Cluster-wide barometric plunge (Genuine Weather Event)
        - "HEATWAVE": Cluster-wide extreme heat (Genuine Weather Event)
        - "RESET": Resets all active faults to clean nominal baseline
        """
        if scenario_type == "RESET":
            self.active_injections.clear()
            self.global_scenario = None
            self.global_scenario_ticks = 0
            return {"status": "SUCCESS", "message": "All faults cleared. System returned to nominal state."}

        if scenario_type in ["CYCLONIC_EVENT", "HEATWAVE"]:
            self.global_scenario = scenario_type
            self.global_scenario_ticks = duration_ticks
            return {
                "status": "SUCCESS",
                "message": f"Global Mesoscale Weather Event '{scenario_type}' injected across all {len(self.stations)} AWS nodes."
            }

        # Station-specific sensor fault injection
        target = target_station_id or self.stations[0]["station_id"]
        injection_data = {
            "type": scenario_type,
            "duration": duration_ticks,
            "ticks_left": duration_ticks,
            "custom": custom_params or {}
        }
        self.active_injections[target] = injection_data
        return {
            "status": "SUCCESS",
            "message": f"Fault '{scenario_type}' successfully injected into station {target} for {duration_ticks} ticks."
        }

    def tick(self) -> Dict[str, Dict[str, Any]]:
        """
        Advances the simulation by one 15-minute time step.
        Generates telemetry for all stations, applying active injections,
        and returns the raw readings dictionary.
        """
        self.step_index += 1
        self.simulated_time += timedelta(minutes=15)
        raw_readings: Dict[str, Dict[str, Any]] = {}

        # 1. Base telemetry generation
        for station in self.stations:
            sid = station["station_id"]
            reading = self._generate_base_reading(station, self.simulated_time)
            raw_readings[sid] = reading

        # 2. Apply Global Mesoscale Weather Events (if active)
        if self.global_scenario and self.global_scenario_ticks > 0:
            self.global_scenario_ticks -= 1
            for sid, r in raw_readings.items():
                if self.global_scenario == "CYCLONIC_EVENT":
                    # Severe cyclonic depression: sharp barometric plunge and gale saturation
                    r["pressure"] = round(r["pressure"] - 8.5 + random.gauss(0, 0.4), 2)
                    r["humidity"] = round(min(98.0, r["humidity"] + 22.0), 1)
                    r["temperature"] = round(r["temperature"] - 3.2, 2)
                    r["dew_point"] = compute_dew_point(r["temperature"], r["humidity"])
                elif self.global_scenario == "HEATWAVE":
                    # Regional blistering heatwave
                    r["temperature"] = round(r["temperature"] + 14.5 + random.gauss(0, 0.5), 2)
                    r["humidity"] = round(max(15.0, r["humidity"] - 25.0), 1)
                    r["dew_point"] = compute_dew_point(r["temperature"], r["humidity"])

            if self.global_scenario_ticks <= 0:
                self.global_scenario = None

        # 3. Apply Local Station Sensor Injections (Faults)
        expired_injections = []
        for sid, inj in self.active_injections.items():
            if sid not in raw_readings:
                continue
            r = raw_readings[sid]
            inj_type = inj["type"]
            ticks_left = inj["ticks_left"]

            if inj_type == "SPIKE":
                # Instantaneous violent jump in temperature or pressure
                r["temperature"] = round(r["temperature"] + 16.5, 2)
                r["pressure"] = round(r["pressure"] - 14.0, 2)
            elif inj_type == "STUCK":
                # Freeze at previous reading
                prev = self.history[sid][-1] if self.history[sid] else r
                r["temperature"] = prev["temperature"]
                r["pressure"] = prev["pressure"]
                r["humidity"] = prev["humidity"]
                r["dew_point"] = prev.get("dew_point", compute_dew_point(r["temperature"], r["humidity"]))
            elif inj_type == "DRIFT":
                # Progressive linear drift away from physical reality
                drift_step = (inj["duration"] - ticks_left + 1) * 1.8
                r["temperature"] = round(r["temperature"] + drift_step, 2)
            elif inj_type == "PHYSICS_VIOLATION":
                # Clausius-Clapeyron violation: RH pushed to 99% while T is high -> Dew point > T
                r["temperature"] = 28.0
                r["humidity"] = 125.0 # Unphysical supersaturation
                r["dew_point"] = 34.2
            elif inj_type == "DROPOUT":
                # Hardware packet loss / null readings
                r["temperature"] = None
                r["pressure"] = None
                r["humidity"] = None
                r["dew_point"] = None
            elif inj_type == "OUT_OF_BOUNDS":
                # WMO bound breach
                r["temperature"] = 78.5 # Above 60°C WMO limit

            inj["ticks_left"] -= 1
            if inj["ticks_left"] <= 0:
                expired_injections.append(sid)

        for sid in expired_injections:
            del self.active_injections[sid]

        # Update historical buffers
        for sid, reading in raw_readings.items():
            self.history[sid].append(reading)
            if len(self.history[sid]) > 60:
                self.history[sid].pop(0)
            self.latest_readings[sid] = reading

        return raw_readings
