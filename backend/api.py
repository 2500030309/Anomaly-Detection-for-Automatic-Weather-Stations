"""
SkyGuard AI FastAPI Application & WebSocket Stream
Provides REST endpoints and live WebSocket connection for the interactive dashboard.
"""

import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
import io
import csv

from backend.simulator import AWSSimulator
from backend.engine.pipeline import SkyGuardEngine
from backend.engine.dispatcher import MaintenanceDispatcher
from backend.engine.benchmark import PerformanceBenchmark
from backend.models import TelemetryInput, ScenarioInjectionRequest

app = FastAPI(
    title="SkyGuard AI: Real-Time Anomaly Detection for AWS",
    description="SIH PS ID 26073 - 4-Layer Consistency & Explainable QC Engine for Automatic Weather Stations",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Core singletons
simulator = AWSSimulator("data/sample_stations.json")
engine = SkyGuardEngine()
dispatcher = MaintenanceDispatcher()
benchmark = PerformanceBenchmark(engine)

# In-memory storage for batch CSV upload results
last_cleaned_csv_data: str = ""

# Active WebSocket connections
active_connections: List[WebSocket] = []

def run_evaluation_cycle():
    """Evaluates all latest station readings through the 4-layer engine."""
    evaluations: Dict[str, Any] = {}
    for station in simulator.stations:
        sid = station["station_id"]
        reading = simulator.latest_readings.get(sid, {})
        history = simulator.history.get(sid, [])
        past_v = simulator.past_verdicts.get(sid, [])

        eval_res = engine.analyze_station(
            target_station=station,
            current_reading=reading,
            all_stations=simulator.stations,
            all_latest_readings=simulator.latest_readings,
            target_history=history[:-1] if len(history) > 1 else [],
            all_histories=simulator.history,
            past_verdicts=past_v
        )
        evaluations[sid] = eval_res
        simulator.latest_evaluations[sid] = eval_res
        simulator.past_verdicts[sid].append(eval_res["verdict"])
        if len(simulator.past_verdicts[sid]) > 60:
            simulator.past_verdicts[sid].pop(0)

    return evaluations

# Initial evaluation cycle
run_evaluation_cycle()

@app.get("/api/stations")
def get_stations():
    """Returns all AWS stations with their current status, verdict, and health score."""
    result = []
    for s in simulator.stations:
        sid = s["station_id"]
        eval_data = simulator.latest_evaluations.get(sid, {})
        item = dict(s)
        item["reading"] = simulator.latest_readings.get(sid, {})
        item["verdict"] = eval_data.get("verdict", "NORMAL")
        item["verdict_reason"] = eval_data.get("verdict_reason", "Nominal")
        item["health"] = eval_data.get("health", {"health_score": 100, "status": "HEALTHY", "maintenance_priority": "LOW"})
        item["root_cause"] = eval_data.get("root_cause", {})
        result.append(item)
    return {"stations": result, "simulated_time": simulator.simulated_time.isoformat()}

@app.get("/api/stations/{station_id}")
def get_station_detail(station_id: str):
    """Returns full detailed inspection and history for a specific station."""
    station = next((s for s in simulator.stations if s["station_id"] == station_id), None)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    eval_data = simulator.latest_evaluations.get(station_id, {})
    history = simulator.history.get(station_id, [])

    return {
        "station": station,
        "evaluation": eval_data,
        "history": history[-30:], # Last 30 time points for graphs
        "active_injection": simulator.active_injections.get(station_id),
        "global_scenario": simulator.global_scenario
    }

@app.post("/api/simulation/tick")
async def simulation_step():
    """Advances simulation clock by one 15-minute interval and broadcasts update."""
    simulator.tick()
    evaluations = run_evaluation_cycle()
    
    payload = {
        "type": "TICK",
        "simulated_time": simulator.simulated_time.isoformat(),
        "step_index": simulator.step_index,
        "evaluations": evaluations,
        "latest_readings": simulator.latest_readings,
        "global_scenario": simulator.global_scenario
    }

    # Broadcast to active WebSockets
    for ws in active_connections[:]:
        try:
            await ws.send_json(payload)
        except Exception:
            if ws in active_connections:
                active_connections.remove(ws)

    return payload

@app.post("/api/simulation/inject")
def inject_scenario(req: ScenarioInjectionRequest):
    """Injects a sensor fault or weather event scenario."""
    res = simulator.inject_scenario(
        scenario_type=req.scenario_type,
        target_station_id=req.target_station_id,
        duration_ticks=req.duration_ticks,
        custom_params=req.custom_params
    )
    # Re-evaluate current state immediately
    run_evaluation_cycle()
    return res

@app.post("/api/simulation/reset")
def reset_simulation():
    """Resets all injected anomalies back to nominal baseline."""
    res = simulator.inject_scenario("RESET")
    run_evaluation_cycle()
    return res

@app.post("/api/telemetry/manual")
def manual_telemetry(reading: TelemetryInput):
    """Allows manual ad-hoc telemetry submission and runs the 4-layer engine immediately."""
    station = next((s for s in simulator.stations if s["station_id"] == reading.station_id), None)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    raw_reading = reading.dict()
    eval_res = engine.analyze_station(
        target_station=station,
        current_reading=raw_reading,
        all_stations=simulator.stations,
        all_latest_readings=simulator.latest_readings,
        target_history=simulator.history.get(reading.station_id, []),
        all_histories=simulator.history
    )
    return eval_res

@app.get("/api/maintenance/queue")
def get_maintenance_queue():
    """Returns prioritized AWS maintenance queue for field engineers."""
    queue = []
    for s in simulator.stations:
        sid = s["station_id"]
        eval_data = simulator.latest_evaluations.get(sid, {})
        health = eval_data.get("health", {})
        root_cause = eval_data.get("root_cause", {})
        verdict = eval_data.get("verdict", "NORMAL")

        if verdict == "SENSOR_FAULT" or health.get("health_score", 100) < 85.0:
            queue.append({
                "station_id": sid,
                "name": s["name"],
                "district": s["district"],
                "health_score": health.get("health_score", 100),
                "priority": health.get("maintenance_priority", "LOW"),
                "status": health.get("status", "HEALTHY"),
                "diagnosis": root_cause.get("summary", "Unspecified anomaly"),
                "recommended_action": root_cause.get("action", "Inspect station.")
            })

    # Sort queue by lowest health score first
    queue.sort(key=lambda x: x["health_score"])
    return {"queue": queue, "total_faulty_stations": len(queue)}

@app.get("/api/export/report")
def export_audit_report():
    """Exports full audit summary of all stations, layers, and verdicts."""
    report = {
        "timestamp": simulator.simulated_time.isoformat(),
        "total_stations": len(simulator.stations),
        "healthy_stations": sum(1 for e in simulator.latest_evaluations.values() if e.get("verdict") == "NORMAL"),
        "sensor_faults": sum(1 for e in simulator.latest_evaluations.values() if e.get("verdict") == "SENSOR_FAULT"),
        "weather_events": sum(1 for e in simulator.latest_evaluations.values() if e.get("verdict") == "WEATHER_EVENT"),
        "uncertain": sum(1 for e in simulator.latest_evaluations.values() if e.get("verdict") == "UNCERTAIN"),
        "stations_audit": [
            {
                "station_id": sid,
                "name": next(s["name"] for s in simulator.stations if s["station_id"] == sid),
                "verdict": eval_data.get("verdict"),
                "reason": eval_data.get("verdict_reason"),
                "health_score": eval_data.get("health", {}).get("health_score"),
                "attribution": eval_data.get("attribution"),
                "reading": simulator.latest_readings.get(sid)
            }
            for sid, eval_data in simulator.latest_evaluations.items()
        ]
    }
    return report

@app.get("/api/benchmark/live")
def get_live_benchmark():
    """Runs real-time inference latency benchmark and returns model comparison matrix."""
    sample_station = simulator.stations[0]
    return benchmark.run_live_latency_benchmark(sample_station, n_iterations=40)

@app.get("/api/dispatch/tickets")
def get_dispatch_tickets():
    """Returns active and past field maintenance tickets."""
    # Ensure current faulty stations have tickets
    for sid, eval_data in simulator.latest_evaluations.items():
        if eval_data.get("verdict") == "SENSOR_FAULT" or eval_data.get("health", {}).get("health_score", 100) < 75.0:
            st = next(s for s in simulator.stations if s["station_id"] == sid)
            dispatcher.generate_ticket(st, eval_data)
    return {"tickets": dispatcher.get_all_tickets()}

@app.post("/api/dispatch/create/{station_id}")
def create_dispatch_ticket(station_id: str):
    """Manually creates a field technician dispatch ticket for a specific station."""
    station = next((s for s in simulator.stations if s["station_id"] == station_id), None)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    eval_data = simulator.latest_evaluations.get(station_id, {})
    ticket = dispatcher.generate_ticket(station, eval_data)
    return ticket

@app.post("/api/qc/upload-csv")
async def upload_csv_data(file: UploadFile = File(...)):
    """
    Ingests meteorological CSV telemetry, evaluates each row through 4-stage SkyGuard QC,
    applies spatial-physics data self-healing, and returns full batch metrics and cleaned preview.
    """
    global last_cleaned_csv_data
    content = await file.read()
    text = content.decode("utf-8", errors="ignore")
    
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty or missing headers")

    processed = []
    cleaned_rows = []
    fault_count = 0
    weather_count = 0
    clean_count = 0
    healed_count = 0

    dummy_station = simulator.stations[0]

    for idx, row in enumerate(rows):
        def parse_float(val, default=None):
            try:
                return float(val) if val not in [None, "", "NaN", "null"] else default
            except ValueError:
                return default

        t = parse_float(row.get("temperature") or row.get("temp") or row.get("T"))
        p = parse_float(row.get("pressure") or row.get("pres") or row.get("P"))
        rh = parse_float(row.get("humidity") or row.get("rh") or row.get("RH"))
        ts = row.get("timestamp") or row.get("time") or f"2026-10-01T{idx:02d}:00:00"
        sid = row.get("station_id") or dummy_station["station_id"]

        station_obj = next((s for s in simulator.stations if s["station_id"] == sid), dummy_station)
        reading = {"timestamp": ts, "temperature": t, "pressure": p, "humidity": rh}

        all_network_readings = dict(simulator.latest_readings)
        all_network_readings[station_obj["station_id"]] = reading

        eval_res = engine.analyze_station(
            target_station=station_obj,
            current_reading=reading,
            all_stations=simulator.stations,
            all_latest_readings=all_network_readings,
            target_history=[r["reading"] for r in processed[-5:]] if processed else []
        )

        v = eval_res["verdict"]
        if v == "NORMAL": clean_count += 1
        elif v == "SENSOR_FAULT": fault_count += 1
        elif v == "WEATHER_EVENT": weather_count += 1

        if eval_res.get("is_healed"):
            healed_count += 1

        processed.append(eval_res)

        # Build output row for cleaned CSV
        cleaned = eval_res.get("imputed_reading", reading)
        flags = eval_res.get("qc_flags", {})
        cleaned_rows.append({
            "timestamp": ts,
            "station_id": sid,
            "raw_temperature": t,
            "raw_pressure": p,
            "raw_humidity": rh,
            "cleaned_temperature": cleaned.get("temperature"),
            "cleaned_pressure": cleaned.get("pressure"),
            "cleaned_humidity": cleaned.get("humidity"),
            "cleaned_dew_point": cleaned.get("dew_point"),
            "verdict": v,
            "verdict_reason": eval_res.get("verdict_reason"),
            "wmo_qc_temp_flag": flags.get("temperature", 0),
            "wmo_qc_pres_flag": flags.get("pressure", 0),
            "wmo_qc_rh_flag": flags.get("humidity", 0)
        })

    # Generate CSV string for download
    output = io.StringIO()
    if cleaned_rows:
        writer = csv.DictWriter(output, fieldnames=list(cleaned_rows[0].keys()))
        writer.writeheader()
        writer.writerows(cleaned_rows)
        last_cleaned_csv_data = output.getvalue()

    return {
        "total_records": len(rows),
        "clean_records": clean_count,
        "sensor_faults": fault_count,
        "weather_events": weather_count,
        "healed_records": healed_count,
        "preview": cleaned_rows[:15]
    }

@app.get("/api/qc/download-cleaned-csv")
def download_cleaned_csv():
    """Downloads the cleaned, imputed, WMO-flagged CSV from the last batch QC run."""
    global last_cleaned_csv_data
    if not last_cleaned_csv_data:
        with open("data/sample_imd_telemetry.csv", "r") as f:
            last_cleaned_csv_data = f.read()

    return Response(
        content=last_cleaned_csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=SkyGuard_Cleaned_WMO_Dataset.csv"}
    )

@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    """Streams live telemetry ticks to the connected frontend dashboard."""
    await websocket.accept()
    active_connections.append(websocket)
    try:
        # Send initial snapshot upon connection
        init_payload = {
            "type": "INITIAL_SNAPSHOT",
            "simulated_time": simulator.simulated_time.isoformat(),
            "stations": simulator.stations,
            "latest_readings": simulator.latest_readings,
            "evaluations": simulator.latest_evaluations,
            "global_scenario": simulator.global_scenario
        }
        await websocket.send_json(init_payload)

        while True:
            # Keep-alive loop listening for client messages or ticks
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)
    except Exception:
        if websocket in active_connections:
            active_connections.remove(websocket)

# Mount frontend static files
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
