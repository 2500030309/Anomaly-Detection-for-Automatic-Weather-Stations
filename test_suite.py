"""
SkyGuard AI - Comprehensive Automated Test Suite (Upgraded)
Validates all 4 consistency QC layers, LSTM Autoencoder, Data Imputer,
Field Dispatcher, and Performance Benchmark SLA.
"""

import unittest
from backend.simulator import AWSSimulator
from backend.engine.pipeline import SkyGuardEngine
from backend.engine.physics import check_thermodynamic_consistency
from backend.engine.lstm_autoencoder import LSTMAutoencoder
from backend.engine.imputation import DataImputer, WMO_FLAG_GOOD, WMO_FLAG_HEALED
from backend.engine.dispatcher import MaintenanceDispatcher
from backend.engine.benchmark import PerformanceBenchmark

class TestSkyGuardAI(unittest.TestCase):
    def setUp(self):
        self.sim = AWSSimulator("data/sample_stations.json")
        self.engine = SkyGuardEngine()
        self.stations = self.sim.stations

    def test_layer1_bounds_and_flatline(self):
        """Test L1 Physical bounds and flatline detection."""
        station = self.stations[0]
        bad_reading = {"temperature": 85.0, "pressure": 1010.0, "humidity": 50.0}
        eval_res = self.engine.analyze_station(station, bad_reading, self.stations, {station["station_id"]: bad_reading})
        self.assertEqual(eval_res["verdict"], "SENSOR_FAULT")
        self.assertFalse(eval_res["layers"]["l1_rules"]["passed"])

        # Flatline test
        flat_hist = [{"temperature": 28.0, "pressure": 1010.0, "humidity": 60.0} for _ in range(5)]
        eval_flat = self.engine.analyze_station(station, flat_hist[-1], self.stations, {station["station_id"]: flat_hist[-1]}, flat_hist[:-1])
        self.assertEqual(eval_flat["verdict"], "SENSOR_FAULT")
        self.assertIn("STUCK_FLATLINE", eval_flat["verdict_reason"])

    def test_layer2_temporal_ml_and_lstm(self):
        """Test L2 Isolation Forest and Neural LSTM Autoencoder."""
        cur = {"temperature": 28.0, "pressure": 1010.0, "humidity": 65.0}
        l2_res = self.engine.l2.evaluate(cur, [{"temperature": 27.9, "pressure": 1010.1, "humidity": 65.2}])
        self.assertIn("anomaly_score", l2_res)
        self.assertLess(l2_res["anomaly_score"], 0.6)

        # Test LSTM Autoencoder
        lstm = LSTMAutoencoder()
        eval_lstm = lstm.evaluate(cur, [])
        self.assertIn("reconstruction_loss", eval_lstm)
        self.assertTrue(eval_lstm["passed"])

    def test_layer3_magnus_dew_point_physics(self):
        """Test Layer 3 thermodynamic invariant Td <= T."""
        valid_res = check_thermodynamic_consistency(temp_c=30.0, humidity=60.0)
        self.assertTrue(valid_res["is_valid"])
        self.assertLessEqual(valid_res["dew_point"], 30.0)

        breach_reading = {"temperature": 25.0, "pressure": 1010.0, "humidity": 125.0}
        l3_res = self.engine.l3.evaluate(breach_reading)
        self.assertFalse(l3_res["passed"])
        self.assertIn("UNPHYSICAL_DEW_POINT", l3_res["flags"])

    def test_layer4_sensor_spike(self):
        """Test L4: isolated Sensor Spike on single station."""
        sim = AWSSimulator("data/sample_stations.json")
        sim.inject_scenario("SPIKE", "AWS-OD-001")
        spike_readings = sim.tick()
        spike_eval = self.engine.analyze_station(
            sim.stations[0],
            spike_readings["AWS-OD-001"],
            sim.stations,
            spike_readings,
            sim.history["AWS-OD-001"][:-1],
            sim.history
        )
        self.assertEqual(spike_eval["verdict"], "SENSOR_FAULT")
        self.assertEqual(spike_eval["root_cause"]["subtype"], "SPIKE")

    def test_layer4_cyclone_weather_event(self):
        """Test L4: genuine Mesoscale Cyclone Event with spatial consensus."""
        sim = AWSSimulator("data/sample_stations.json")
        sim.inject_scenario("CYCLONIC_EVENT")
        cyclone_readings = sim.tick()
        cyclone_eval = self.engine.analyze_station(
            sim.stations[0],
            cyclone_readings["AWS-OD-001"],
            sim.stations,
            cyclone_readings,
            sim.history["AWS-OD-001"][:-1],
            sim.history
        )
        self.assertEqual(cyclone_eval["verdict"], "WEATHER_EVENT")
        self.assertEqual(cyclone_eval["root_cause"]["category"], "ATMOSPHERIC_EXTREME")

    def test_automated_data_imputer(self):
        """Test Data Imputer self-healing on sensor fault."""
        imputer = DataImputer()
        station = self.stations[0]
        corrupted_reading = {"temperature": 85.0, "pressure": 1010.0, "humidity": 60.0}
        neighbors_readings = {
            s["station_id"]: {"temperature": 28.5, "pressure": 1010.0, "humidity": 65.0}
            for s in self.stations
        }
        res = imputer.heal_reading(
            target_station=station,
            raw_reading=corrupted_reading,
            verdict="SENSOR_FAULT",
            violations={"temperature": "Spike"},
            all_stations=self.stations,
            all_latest_readings=neighbors_readings
        )
        self.assertTrue(res["is_healed"])
        self.assertIn("temperature", res["healed_params"])
        self.assertLess(res["reading"]["temperature"], 35.0) # Healed to ~28.5°C
        self.assertEqual(res["qc_flags"]["temperature"], WMO_FLAG_HEALED)

    def test_maintenance_dispatcher(self):
        """Test Field Maintenance Work Order generation."""
        dispatcher = MaintenanceDispatcher()
        station = self.stations[0]
        eval_data = {
            "verdict": "SENSOR_FAULT",
            "health": {"health_score": 35.0, "maintenance_priority": "URGENT"},
            "root_cause": {"category": "HARDWARE_RULE_FAILURE", "subtype": "SPIKE", "summary": "Thermistor Failure"}
        }
        ticket = dispatcher.generate_ticket(station, eval_data)
        self.assertIn("IMD-TICKET", ticket["ticket_id"])
        self.assertEqual(ticket["priority"], "URGENT")
        self.assertGreater(len(ticket["required_spare_parts"]), 0)

    def test_performance_benchmark_sla(self):
        """Test Inference Latency SLA (< 100ms per record)."""
        benchmark = PerformanceBenchmark(self.engine)
        perf = benchmark.run_live_latency_benchmark(self.stations[0], n_iterations=20)
        self.assertTrue(perf["meets_realtime_sla"])
        self.assertLess(perf["p95_ms"], 100.0)

if __name__ == "__main__":
    unittest.main()
