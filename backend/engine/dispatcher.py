"""
Automated Maintenance Dispatch & Work Order Generator
Generates actionable field engineering tickets with meteorological spare parts,
priority routing, and dispatch payload formatting for IMD technical crews.
"""

from typing import Dict, List, Any
from datetime import datetime, timezone
import random

# Meteorological spare parts catalog for Automatic Weather Stations
SPARE_PARTS_CATALOG = {
    "SPIKE": [
        {"part_no": "AWS-RTD-PT100A", "name": "PT100 RTD 4-Wire Temperature Probe", "category": "Sensors"},
        {"part_no": "AWS-SIG-ISOL", "name": "4-20mA Analog Signal Ground Isolator", "category": "Electronics"}
    ],
    "STUCK_FLATLINE": [
        {"part_no": "AWS-BARO-VAI", "name": "Barometric Pressure Transducer (Vaisala PTB110 Equivalent)", "category": "Transducer"},
        {"part_no": "AWS-ADC-MOD", "name": "16-Bit Low-Power ADC Telemetry Interface", "category": "Board"}
    ],
    "CALIBRATION_DRIFT": [
        {"part_no": "AWS-CAL-REF", "name": "Field Calibration Reference Kit & Traceable Resistor", "category": "Calibration"},
        {"part_no": "AWS-SHIELD-LOUV", "name": "Naturally Aspirated Solar Radiation Shield", "category": "Mechanical"}
    ],
    "PHYSICS_VIOLATION": [
        {"part_no": "AWS-HUMI-CAP", "name": "Capacitive Thin-Film Relative Humidity Sensor", "category": "Sensors"},
        {"part_no": "AWS-DESIC-100", "name": "Silica Gel Desiccant Pack & Hermetic O-Ring", "category": "Consumables"}
    ],
    "COMM_DROPOUT": [
        {"part_no": "AWS-GSM-4G", "name": "GPRS/4G Industrial Telemetry Modem & SIM", "category": "Comms"},
        {"part_no": "AWS-BATT-LFP", "name": "12V 40Ah LiFePO4 Solar Buffer Battery", "category": "Power"}
    ],
    "OUT_OF_BOUNDS": [
        {"part_no": "AWS-RTD-PT100A", "name": "PT100 RTD 4-Wire Temperature Probe", "category": "Sensors"},
        {"part_no": "AWS-SURGE-PROT", "name": "Lightning & Transient Surge Suppressor", "category": "Protection"}
    ]
}

class MaintenanceDispatcher:
    def __init__(self):
        self.dispatched_tickets: Dict[str, Dict[str, Any]] = {}

    def generate_ticket(
        self,
        station: Dict[str, Any],
        eval_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Creates an actionable field dispatch work order for a degraded or faulty station.
        """
        sid = station["station_id"]
        verdict = eval_data.get("verdict", "NORMAL")
        health = eval_data.get("health", {})
        root_cause = eval_data.get("root_cause", {})
        subtype = root_cause.get("subtype", "SPIKE")

        priority = health.get("maintenance_priority", "MEDIUM")
        health_score = health.get("health_score", 100)

        # Generate unique ticket ID
        ticket_id = f"IMD-TICKET-2026-{station['code']}-{random.randint(100, 999)}"

        parts = SPARE_PARTS_CATALOG.get(subtype, SPARE_PARTS_CATALOG["SPIKE"])

        # Determine nearest IMD regional workshop
        workshop = "IMD Regional Meteorological Centre, Bhubaneswar"
        distance_km = round(random.uniform(15.0, 75.0), 1)
        eta_hours = round(distance_km / 35.0, 1) # Estimated travel speed 35 km/h

        ticket = {
            "ticket_id": ticket_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "station_id": sid,
            "station_name": station["name"],
            "station_code": station["code"],
            "district": station["district"],
            "gps_coordinates": f"{station['latitude']}°N, {station['longitude']}°E",
            "health_score": health_score,
            "priority": priority,
            "failure_category": root_cause.get("category", "SENSOR_MALFUNCTION"),
            "diagnosis": root_cause.get("summary", "Unspecified sensor anomaly"),
            "root_cause_detail": root_cause.get("detail", ""),
            "action_required": root_cause.get("action", "Inspect and calibrate."),
            "required_spare_parts": parts,
            "dispatch_team": f"Odisha State Field Crew {random.choice(['Alpha', 'Bravo', 'Delta'])}",
            "assigned_centre": workshop,
            "travel_distance_km": distance_km,
            "estimated_eta_hrs": eta_hours,
            "dispatch_status": "DISPATCHED" if priority in ["URGENT", "HIGH"] else "SCHEDULED",
            "notification_channels": ["SMS", "WhatsApp_Alert", "IMD_Field_Portal_Webhook"]
        }

        self.dispatched_tickets[sid] = ticket
        return ticket

    def get_all_tickets(self) -> List[Dict[str, Any]]:
        return list(self.dispatched_tickets.values())
