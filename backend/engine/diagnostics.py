"""
Diagnostics, Root Cause Attribution, and Explainability (SHAP-style)
Provides transparent causal explanations, sensor health scoring, and maintenance priority.
"""

from typing import Dict, List, Any
import numpy as np

class SkyGuardDiagnostics:
    def __init__(self):
        pass

    def compute_attribution(
        self,
        current: Dict[str, float],
        l1_res: Dict[str, Any],
        l2_res: Dict[str, Any],
        l3_res: Dict[str, Any],
        l4_res: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Synthesizes SHAP-style attribution scores indicating the relative contribution
        of Temperature, Pressure, and Humidity to the anomaly verdict.
        """
        weights = {"temperature": 0.0, "pressure": 0.0, "humidity": 0.0}

        # 1. L1 contributions
        for param, viol in l1_res.get("violations", {}).items():
            if param in weights:
                weights[param] += 3.0

        # 2. L2 temporal ML contributions
        l2_contribs = l2_res.get("contributions", {})
        for param, c in l2_contribs.items():
            if param in weights:
                weights[param] += c * (2.0 if l2_res.get("is_anomaly") else 0.5)

        # 3. L3 physics contributions
        if not l3_res.get("passed", True):
            # Dew point violation primarily stems from Humidity or Temperature
            weights["humidity"] += 2.5
            weights["temperature"] += 1.5

        # 4. L4 spatial contributions
        z_scores = l4_res.get("spatial_z_scores", {})
        for param, z in z_scores.items():
            if param in weights:
                weights[param] += abs(z) * 1.0

        total = sum(weights.values()) + 1e-6
        return {
            param: round(float(val / total) * 100.0, 1)
            for param, val in weights.items()
        }

    def determine_root_cause(
        self,
        l1_res: Dict[str, Any],
        l2_res: Dict[str, Any],
        l3_res: Dict[str, Any],
        l4_res: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Synthesizes diagnostic explanation and maintenance recommendation.
        """
        # Priority Case 1: Verified Mesoscale Weather Event (Cyclone, Squall, Heatwave)
        if l4_res.get("is_weather_event"):
            we = l4_res.get("weather_event_type", "MESOSCALE_EVENT")
            return {
                "category": "ATMOSPHERIC_EXTREME",
                "subtype": we,
                "summary": f"Verified Severe Weather Phenomenon: {we}",
                "detail": l4_res.get("details", ""),
                "action": "Retain observation for numerical weather prediction (NWP) & issue meteorological warning."
            }

        # Case 2: L1 Direct Fault (Hardware bounds, stuck, dropout)
        if not l1_res.get("passed", True):
            ft = l1_res.get("fault_type", "OUT_OF_BOUNDS")
            return {
                "category": "HARDWARE_RULE_FAILURE",
                "subtype": ft,
                "summary": f"Hardware Rule Violation: {ft}",
                "detail": l1_res.get("details", ""),
                "action": "Immediate transducer calibration or sensor replacement required."
            }

        # Case 2: L3 Physics Invariant Breach
        if not l3_res.get("passed", True):
            return {
                "category": "THERMODYNAMIC_PHYSICS_FAILURE",
                "subtype": "PHYSICS_VIOLATION",
                "summary": "Clausius-Clapeyron Thermodynamic Breach",
                "detail": l3_res.get("details", ""),
                "action": "Inspect capacitive humidity sensor for water ingress or hygrometer drift."
            }

        # Case 4: L4 Spatial Discordance (Sensor Fault vs Mesoscale Event)

        if l4_res.get("is_spatial_outlier"):
            return {
                "category": "LOCAL_SENSOR_ANOMALY",
                "subtype": "CALIBRATION_DRIFT" if not l2_res.get("is_anomaly") else "SPIKE",
                "summary": "Station-Specific Outlier Uncorroborated by Spatial Network",
                "detail": l4_res.get("details", ""),
                "action": "Schedule on-site AWS field verification to inspect sensor shield and cable wiring."
            }

        # Case 4: L2 Subtle Temporal Outlier
        if l2_res.get("is_anomaly"):
            return {
                "category": "TEMPORAL_DYNAMICS_ANOMALY",
                "subtype": "TEMPORAL_OUTLIER",
                "summary": "Unusual Multi-Sensor Rate of Change",
                "detail": l2_res.get("details", ""),
                "action": "Flag for human meteorologist review."
            }

        # Nominal Case
        return {
            "category": "NOMINAL",
            "subtype": "NONE",
            "summary": "All 4 QC Validation Layers Verified",
            "detail": "Data satisfies physical bounds, temporal bounds, thermodynamics, and spatial network consensus.",
            "action": "No maintenance required. AWS operational."
        }

    def compute_health_index(
        self,
        past_verdicts: List[str],
        current_verdict: str,
        l1_passed: bool,
        l3_passed: bool
    ) -> Dict[str, Any]:
        """
        Computes dynamic station health score from 0% (dead) to 100% (flawless).
        """
        all_v = past_verdicts[-20:] + [current_verdict]
        fault_count = sum(1 for v in all_v if v == "SENSOR_FAULT")
        weather_count = sum(1 for v in all_v if v == "WEATHER_EVENT")
        
        # Base penalty from past faults
        fault_ratio = fault_count / max(1, len(all_v))
        health = 100.0 - (fault_ratio * 70.0)

        # Immediate penalty for active rule or physics violation
        if not l1_passed:
            health -= 25.0
        if not l3_passed:
            health -= 20.0
        if current_verdict == "SENSOR_FAULT":
            health -= 15.0

        health = max(5.0, min(100.0, health))
        health_score = round(health, 1)

        if health_score >= 88.0:
            status = "HEALTHY"
            priority = "LOW"
            badge_class = "health-good"
        elif health_score >= 65.0:
            status = "MONITOR"
            priority = "MEDIUM"
            badge_class = "health-warning"
        elif health_score >= 40.0:
            status = "DEGRADED"
            priority = "HIGH"
            badge_class = "health-degraded"
        else:
            status = "CRITICAL_FAILURE"
            priority = "URGENT"
            badge_class = "health-critical"

        return {
            "health_score": health_score,
            "status": status,
            "maintenance_priority": priority,
            "badge_class": badge_class
        }
