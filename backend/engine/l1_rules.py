"""
Layer 1: Physical Range, Rate-of-Change, and Flatline Rule QC
Directly implements WMO-No. 8 operational bounds and sensor stuck checks.
"""

from typing import Dict, List, Any, Optional
import numpy as np
from backend.config import BOUNDS_CONFIG, STEP_LIMITS, PERSISTENCE_LIMITS

class Layer1RulesQC:
    def __init__(self):
        self.bounds = BOUNDS_CONFIG
        self.step_limits = STEP_LIMITS
        self.persistence = PERSISTENCE_LIMITS

    def evaluate(self, current: Dict[str, float], history: List[Dict[str, float]]) -> Dict[str, Any]:
        """
        Runs L1 QC on current telemetry given past history of readings.
        """
        flags: List[str] = []
        violations: Dict[str, Any] = {}
        is_passed = True
        fault_type = None

        # 1. Null / Dropout Check
        for param in ["temperature", "pressure", "humidity"]:
            val = current.get(param)
            if val is None or not isinstance(val, (int, float)) or np.isnan(val):
                flags.append(f"MISSING_{param.upper()}")
                violations[param] = "Value is null, NaN or missing"
                fault_type = "COMM_DROPOUT"
                is_passed = False

        if not is_passed:
            return {
                "passed": False,
                "fault_type": fault_type,
                "flags": flags,
                "violations": violations,
                "details": "Telemetry contains missing or corrupt sensor values (transmission dropout)."
            }

        # 2. Physical Range Check (WMO-No. 8)
        for param, limits in self.bounds.items():
            val = float(current[param])
            if val < limits["min"] or val > limits["max"]:
                flags.append(f"OUT_OF_BOUNDS_{param.upper()}")
                violations[param] = f"Value {val}{limits['unit']} outside physical limits [{limits['min']}, {limits['max']}]"
                is_passed = False
                fault_type = "OUT_OF_BOUNDS"

        # 3. Rate-of-Change (Step Limit) Check
        if history and len(history) > 0:
            last = history[-1]
            for param, limit in self.step_limits.items():
                if param in current and param in last and last[param] is not None:
                    delta = abs(float(current[param]) - float(last[param]))
                    if delta > limit:
                        flags.append(f"RATE_OF_CHANGE_{param.upper()}")
                        violations[param] = f"15-min delta {round(delta, 2)} exceeds maximum plausible rate {limit}"
                        is_passed = False
                        if not fault_type:
                            fault_type = "SPIKE"

        # 4. Persistence / Stuck Sensor Check (Flatline)
        # Needs at least 4 past readings
        recent_window = (history + [current])[-5:]
        if len(recent_window) >= 4:
            for param, pcfg in self.persistence.items():
                vals = [r[param] for r in recent_window if param in r and r[param] is not None]
                if len(vals) >= 4:
                    std_dev = float(np.std(vals))
                    if std_dev < pcfg["min_std"]:
                        flags.append(f"STUCK_FLATLINE_{param.upper()}")
                        violations[param] = f"Variance near zero ({round(std_dev, 4)}) over {len(vals)} steps. Transducer is frozen/stuck."
                        is_passed = False
                        fault_type = "STUCK_FLATLINE"

        return {
            "passed": is_passed,
            "fault_type": fault_type,
            "flags": flags,
            "violations": violations,
            "details": (
                "All L1 Physical & Rule checks passed."
                if is_passed else
                f"L1 Violation: {'; '.join(flags)}"
            )
        }
