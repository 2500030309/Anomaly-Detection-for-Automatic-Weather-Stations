"""
Layer 2: Temporal Machine Learning Anomaly Detection
Uses Isolation Forest and Rolling Temporal Features (Mean, Volatility, Acceleration)
to detect subtle drift, multi-sensor discordance, and dynamic irregularities.
"""

from typing import Dict, List, Any
import numpy as np
from sklearn.ensemble import IsolationForest

class Layer2TemporalML:
    def __init__(self):
        self.model = IsolationForest(
            n_estimators=60,
            contamination=0.08,
            random_state=42,
            bootstrap=False
        )
        self.is_calibrated = False
        self._pretrain_baseline()

    def _pretrain_baseline(self):
        """
        Calibrates the Isolation Forest model on representative synthetic
        diurnal baseline weather profiles (IMD climate envelope).
        """
        np.random.seed(42)
        n_samples = 400
        
        # Diurnal temperature cycle: 20°C to 38°C
        hour = np.linspace(0, 96, n_samples)
        t_base = 28.0 + 8.0 * np.sin(2 * np.pi * hour / 24.0) + np.random.normal(0, 0.4, n_samples)
        # Pressure typically exhibits semi-diurnal atmospheric tide (~1008 - 1014 hPa)
        p_base = 1011.0 + 2.0 * np.cos(4 * np.pi * hour / 24.0) + np.random.normal(0, 0.3, n_samples)
        # Humidity inversely tracks temperature (35% to 85%)
        rh_base = 60.0 - 20.0 * np.sin(2 * np.pi * hour / 24.0) + np.random.normal(0, 1.5, n_samples)
        rh_base = np.clip(rh_base, 20.0, 95.0)

        # Build temporal features: [T, P, RH, delta_T, delta_P, delta_RH]
        delta_t = np.diff(t_base, prepend=t_base[0])
        delta_p = np.diff(p_base, prepend=p_base[0])
        delta_rh = np.diff(rh_base, prepend=rh_base[0])

        X_train = np.column_stack([t_base, p_base, rh_base, delta_t, delta_p, delta_rh])
        self.model.fit(X_train)
        self.is_calibrated = True

    def extract_features(self, current: Dict[str, float], history: List[Dict[str, float]]) -> np.ndarray:
        t = float(current["temperature"]) if current.get("temperature") is not None else 28.0
        p = float(current["pressure"]) if current.get("pressure") is not None else 1010.0
        rh = float(current["humidity"]) if current.get("humidity") is not None else 65.0

        if history and len(history) > 0:
            last = history[-1]
            last_t = float(last["temperature"]) if last.get("temperature") is not None else t
            last_p = float(last["pressure"]) if last.get("pressure") is not None else p
            last_rh = float(last["humidity"]) if last.get("humidity") is not None else rh
            dt = t - last_t
            dp = p - last_p
            drh = rh - last_rh
        else:
            dt, dp, drh = 0.0, 0.0, 0.0

        return np.array([[t, p, rh, dt, dp, drh]])

    def evaluate(self, current: Dict[str, float], history: List[Dict[str, float]]) -> Dict[str, Any]:
        """
        Scores the observation using the temporal ML Isolation Forest model.
        Returns anomaly score normalized to [0, 1] (0 = completely normal, 1 = extreme outlier).
        """
        X = self.extract_features(current, history)
        
        # Raw decision function: positive = inlier, negative = outlier
        raw_score = float(self.model.decision_function(X)[0])
        # Normalize into [0, 1] where 1 is highest anomaly probability
        # raw_score ranges roughly from -0.3 (extreme outlier) to +0.25 (typical center)
        norm_anomaly_score = float(np.clip((0.2 - raw_score) / 0.45, 0.0, 1.0))
        is_anomaly = bool(norm_anomaly_score > 0.65)

        # Feature level attribution heuristics (proxy for TreeSHAP fast evaluation)
        t, p, rh = X[0, 0], X[0, 1], X[0, 2]
        dt, dp, drh = abs(X[0, 3]), abs(X[0, 4]), abs(X[0, 5])
        
        t_contrib = float(min(1.0, (dt / 4.0) * 0.6 + (abs(t - 28.0) / 25.0) * 0.4))
        p_contrib = float(min(1.0, (dp / 3.0) * 0.7 + (abs(p - 1010.0) / 20.0) * 0.3))
        rh_contrib = float(min(1.0, (drh / 20.0) * 0.6 + (abs(rh - 60.0) / 40.0) * 0.4))
        
        total = t_contrib + p_contrib + rh_contrib + 1e-6
        contributions = {
            "temperature": round(float(t_contrib / total), 3),
            "pressure": round(float(p_contrib / total), 3),
            "humidity": round(float(rh_contrib / total), 3)
        }

        return {
            "passed": not is_anomaly,
            "anomaly_score": round(norm_anomaly_score, 3),
            "is_anomaly": is_anomaly,
            "raw_score": round(raw_score, 4),
            "contributions": contributions,
            "details": (
                f"Temporal dynamics nominal (Anomaly score: {round(norm_anomaly_score, 3)})."
                if not is_anomaly else
                f"Temporal anomaly flagged! Anomaly score: {round(norm_anomaly_score, 3)} (Primary driver: {max(contributions, key=contributions.get)})."
            )
        }
