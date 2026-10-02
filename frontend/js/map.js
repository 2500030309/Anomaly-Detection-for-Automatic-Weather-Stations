/**
 * Leaflet Geospatial Map Module for SkyGuard AI
 * Displays IMD AWS stations across the coastal cluster with live status pins,
 * spatial buddy consensus networks, and toggleable meteorological radar overlay.
 */

class SkyGuardMap {
  constructor(containerId, onStationSelect) {
    this.containerId = containerId;
    this.onStationSelect = onStationSelect;
    this.map = null;
    this.markers = {};
    this.consensusLines = [];
    this.radarLayer = null;
    this.isRadarActive = false;
    this.initMap();
  }

  initMap() {
    // Center around Coastal Odisha & Bay of Bengal AWS cluster (Lat 20.45, Lon 86.0)
    this.map = L.map(this.containerId, {
      center: [20.45, 86.0],
      zoom: 8,
      zoomControl: false,
      attributionControl: false
    });

    // Sleek Dark Carto Tile Layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      subdomains: 'abcd'
    }).addTo(this.map);

    // Zoom control
    L.control.zoom({ position: 'topright' }).addTo(this.map);
  }

  toggleRadar() {
    this.isRadarActive = !this.isRadarActive;
    const btn = document.getElementById('btn-toggle-radar');

    if (this.isRadarActive) {
      if (!this.radarLayer) {
        // RainViewer global precipitation radar mosaic layer
        this.radarLayer = L.tileLayer('https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/{z}/{x}/{y}/2/1_1.png', {
          opacity: 0.65,
          maxZoom: 16
        });
      }
      this.radarLayer.addTo(this.map);
      if (btn) {
        btn.classList.add('active');
        btn.textContent = '📡 Radar: ON';
      }
    } else {
      if (this.radarLayer) {
        this.map.removeLayer(this.radarLayer);
      }
      if (btn) {
        btn.classList.remove('active');
        btn.textContent = '📡 Radar: OFF';
      }
    }
  }

  createPinIcon(code, verdict) {
    let pinClass = 'pin-normal';
    if (verdict === 'SENSOR_FAULT') pinClass = 'pin-fault';
    else if (verdict === 'WEATHER_EVENT') pinClass = 'pin-event';
    else if (verdict === 'UNCERTAIN') pinClass = 'pin-uncertain';

    const html = `
      <div class="custom-station-pin">
        <div class="station-pin-outer ${pinClass}">
          <span class="pin-inner-text">${code.substring(0, 3)}</span>
        </div>
      </div>
    `;

    return L.divIcon({
      className: 'empty-leaflet-wrapper',
      html: html,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  renderStations(stations, evaluations) {
    stations.forEach(station => {
      const sid = station.station_id;
      const evalData = evaluations[sid] || {};
      const verdict = evalData.verdict || 'NORMAL';
      const icon = this.createPinIcon(station.code, verdict);

      if (this.markers[sid]) {
        this.markers[sid].setIcon(icon);
      } else {
        const marker = L.marker([station.latitude, station.longitude], { icon: icon }).addTo(this.map);

        marker.bindTooltip(`
          <div style="font-family: 'Inter', sans-serif; font-size: 11px;">
            <strong>${station.name}</strong><br/>
            Code: <code>${station.code}</code> | Elev: ${station.elevation_m}m<br/>
            Status: <span style="font-weight: 700;">${verdict}</span>
          </div>
        `, { direction: 'top', offset: [0, -10] });

        marker.on('click', () => {
          if (this.onStationSelect) {
            this.onStationSelect(sid);
          }
        });

        this.markers[sid] = marker;
      }
    });
  }

  highlightStation(stationId, neighbors = []) {
    const marker = this.markers[stationId];
    if (!marker) return;

    const latlng = marker.getLatLng();
    this.map.panTo(latlng, { animate: true, duration: 0.5 });

    // Clear existing buddy lines
    this.consensusLines.forEach(line => this.map.removeLayer(line));
    this.consensusLines = [];

    // Draw geodesic buddy connection lines
    if (neighbors && neighbors.length > 0) {
      neighbors.forEach(n => {
        const nMarker = this.markers[n.station_id];
        if (nMarker) {
          const line = L.polyline([latlng, nMarker.getLatLng()], {
            color: '#00f5d4',
            weight: 1.5,
            opacity: 0.6,
            dashArray: '4, 6'
          }).addTo(this.map);
          this.consensusLines.push(line);
        }
      });
    }
  }
}

window.SkyGuardMap = SkyGuardMap;
