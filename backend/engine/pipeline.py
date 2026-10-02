"""
SkyGuard Master Engine Pipeline
Fuses L1 Physical Rules, L2 Temporal ML, L3 Multivariate Physics, and L4 Spatial Consensus
to produce the 4 definitive SIH verdicts: NORMAL, SENSOR_FAULT, WEATHER_EVENT, UNCERTAIN.
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
from backend.config import (
    VERDICT_NORMAL,
    VERDICT_SENSOR_FAULT,
    VERDICT_WEATHER_EVENT,
    VERDICT_UNCERTAIN
)
from backend.engine.l1_rules import Layer1RulesQC
from backend.engine.l2_temporal import Layer2TemporalML
from backend.engine.lstm_autoencoder import LSTMAutoencoder
from backend.engine.l3_multivariate import Layer3MultivariatePhysicsQC
from backend.engine.l4_spatial import Layer4SpatialQC
from backend.engine.diagnostics import SkyGuardDiagnostics
from backend.engine.imputation import DataImputer

class SkyGuardEngine:
    def __init__(self):
        self.l1 = Layer1RulesQC()
        self.l2 = Layer2TemporalML()
        self.lstm = LSTMAutoencoder()
        self.l3 = Layer3MultivariatePhysicsQC()
        self.l4 = Layer4SpatialQC()
        self.diagnostics = SkyGuardDiagnostics()
        self.imputer = DataImputer()

    def analyze_station(
        self,
        target_station: Dict[str, Any],
        current_reading: Dict[str, float],
        all_stations: List[Dict[str, Any]],
        all_latest_readings: Dict[str, Dict[str, float]],
        target_history: Optional[List[Dict[str, float]]] = None,
        all_histories: Optional[Dict[str, List[Dict[str, float]]]] = None,
        past_verdicts: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Executes the full 4-stage SkyGuard QC engine for a single AWS station reading.
        """
        if target_history is None:
            target_history = []
        if past_verdicts is None:
            past_verdicts = []

        timestamp = current_reading.get("timestamp", datetime.now(timezone.utc).isoformat())

        # Layer 1: Physical Bounds, Step Limits, Flatline
        l1_res = self.l1.evaluate(current_reading, target_history)

        # Layer 2: Temporal ML Anomaly Detection (Isolation Forest + LSTM Autoencoder)
        l2_res = self.l2.evaluate(current_reading, target_history)
        lstm_res = self.lstm.evaluate(current_reading, target_history)
        l2_res["lstm_autoencoder"] = lstm_res

        # Layer 3: Multivariate Meteorological Physics (Magnus-Tetens Dew Point)
        l3_res = self.l3.evaluate(current_reading)

        # Layer 4: Spatial Consensus (Buddy Check across neighboring AWS)
        l4_res = self.l4.evaluate(
            target_station=target_station,
            current_reading=current_reading,
            all_stations=all_stations,
            all_latest_readings=all_latest_readings,
            target_history=target_history,
            all_histories=all_histories
        )

        # Arbitration Matrix: Synthesizing Verdict
        verdict = VERDICT_NORMAL
        verdict_reason = "Observation verified across all meteorological & spatial consistency checks."

        # Case 1: Spatial Consensus Confirms Severe Weather (Cyclone, Squall, Heatwave)
        if l4_res.get("is_weather_event"):
            verdict = VERDICT_WEATHER_EVENT
            verdict_reason = f"Validated Mesoscale Weather Event: {l4_res.get('weather_event_type')}. Preserved for forecast models."

        # Case 2: Layer 1 Rule Failure (Physical bounds breach, flatline, dropout)
        elif not l1_res.get("passed"):
            verdict = VERDICT_SENSOR_FAULT
            verdict_reason = f"Sensor Hardware/Telemetry Failure: {l1_res.get('fault_type')} ({'; '.join(l1_res.get('flags', []))})."

        # Case 3: Layer 3 Physics Invariant Failure (Dew Point > Ambient Temperature)
        elif not l3_res.get("passed"):
            verdict = VERDICT_SENSOR_FAULT
            verdict_reason = f"Thermodynamic Physical Violation: Magnus-Tetens Dew Point ({l3_res.get('dew_point')}°C) exceeds Ambient Temp ({current_reading.get('temperature')}°C)."

        # Case 4: Layer 4 Spatial Discordance (Target station diverges from buddies)
        elif l4_res.get("is_spatial_outlier"):
            verdict = VERDICT_SENSOR_FAULT
            verdict_reason = f"Isolated Sensor Anomaly: Station diverges by > {self.l4.z_thresh} sigma from nearby AWS nodes without weather consensus."

        # Case 5: Layer 2 Temporal ML / LSTM Anomaly
        elif l2_res.get("is_anomaly") or lstm_res.get("is_anomaly"):
            if not l4_res.get("has_consensus"):
                verdict = VERDICT_UNCERTAIN
                verdict_reason = f"Unusual temporal dynamics detected (IForest: {l2_res.get('anomaly_score')}, LSTM MSE: {lstm_res.get('reconstruction_loss')}), with sparse buddy corroboration. Flagged for analyst."
            else:
                verdict = VERDICT_SENSOR_FAULT
                verdict_reason = f"Subtle Temporal Sensor Anomaly detected by Ensemble ML (IForest: {l2_res.get('anomaly_score')}, LSTM MSE: {lstm_res.get('reconstruction_loss')})."

        # Explainability & Attribution
        attribution = self.diagnostics.compute_attribution(
            current_reading, l1_res, l2_res, l3_res, l4_res
        )

        # Root Cause Diagnosis & Recommendation
        root_cause = self.diagnostics.determine_root_cause(
            l1_res, l2_res, l3_res, l4_res
        )

        # Health Index
        health = self.diagnostics.compute_health_index(
            past_verdicts, verdict, l1_res["passed"], l3_res["passed"]
        )

        # Automated Data Healing / Imputation
        imputation = self.imputer.heal_reading(
            target_station=target_station,
            raw_reading=current_reading,
            verdict=verdict,
            violations=l1_res.get("violations", {}),
            all_stations=all_stations,
            all_latest_readings=all_latest_readings
        )

        return {
            "station_id": target_station["station_id"],
            "station_name": target_station["name"],
            "timestamp": timestamp,
            "reading": current_reading,
            "imputed_reading": imputation["reading"],
            "is_healed": imputation["is_healed"],
            "healed_params": imputation["healed_params"],
            "qc_flags": imputation["qc_flags"],
            "verdict": verdict,
            "verdict_reason": verdict_reason,
            "layers": {
                "l1_rules": l1_res,
                "l2_temporal": l2_res,
                "l3_physics": l3_res,
                "l4_spatial": l4_res
            },
            "attribution": attribution,
            "root_cause": root_cause,
            "health": health,
            "imputation": imputation
        }
