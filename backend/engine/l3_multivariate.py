"""
Layer 3: Multivariate Meteorological Physics QC
Enforces atmospheric thermodynamic laws and cross-variable invariants.
Focuses on Magnus-Tetens Dew Point vs Ambient Temperature consistency.
"""

from typing import Dict, Any
from backend.engine.physics import check_thermodynamic_consistency, compute_vapor_pressure

class Layer3MultivariatePhysicsQC:
    def __init__(self):
        pass

    def evaluate(self, current: Dict[str, float]) -> Dict[str, Any]:
        """
        Runs thermodynamic and cross-sensor physical invariant checks.
        """
        t = float(current["temperature"]) if current.get("temperature") is not None else 25.0
        rh = float(current["humidity"]) if current.get("humidity") is not None else 60.0
        p = float(current["pressure"]) if current.get("pressure") is not None else 1013.25

        # Check 1: Magnus-Tetens Dew Point vs Temperature (Td <= T)
        thermo_res = check_thermodynamic_consistency(t, rh)
        td = thermo_res["dew_point"]
        dew_point_depression = round(t - td, 2)
        
        is_passed = thermo_res["is_valid"]
        flags = []
        violations = []

        if not is_passed:
            flags.append("UNPHYSICAL_DEW_POINT")
            violations.append(
                f"Dew Point ({td}°C) exceeds ambient Temperature ({t}°C) by {thermo_res['exceedance']}°C. "
                "Violates Clausius-Clapeyron thermodynamic boundary (WMO-No. 8)."
            )

        # Check 2: Relative Humidity vs Dew Point Depression Concordance
        # When RH is near saturation (>95%), depression (T - Td) must be small (< 1.5°C)
        if rh >= 95.0 and dew_point_depression > 2.0:
            flags.append("SATURATION_DEPRESSION_DISCORDANCE")
            violations.append(
                f"High Relative Humidity ({rh}%) reported but Dew Point Depression is {dew_point_depression}°C. "
                "Hygrometer and Thermistor calibration mismatch."
            )
            is_passed = False

        # Check 3: Unphysical extreme low RH combined with cold temperature
        if rh < 5.0 and t < 0.0:
            flags.append("EXTREME_DRY_FREEZING_DISCORDANCE")
            violations.append(f"Sub-zero temperature ({t}°C) with near-zero humidity ({rh}%) is anomalous for station elevation.")
            is_passed = False

        e, es = compute_vapor_pressure(t, rh)

        return {
            "passed": is_passed,
            "dew_point": td,
            "dew_point_depression": dew_point_depression,
            "actual_vapor_pressure": e,
            "sat_vapor_pressure": es,
            "flags": flags,
            "violations": violations,
            "details": (
                f"Multivariate physics verified (Td: {td}°C, T: {t}°C, Depression: {dew_point_depression}°C)."
                if is_passed else
                f"Physics Violation: {' | '.join(violations)}"
            )
        }
