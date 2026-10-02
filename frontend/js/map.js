/**
 * SkyGuard AI - Unified Command Center Map Module
 * Implements:
 * - Google Maps JavaScript API with Advanced Markers and custom dark meteorological theme
 * - Resilient fallback to Leaflet Carto Dark map if API key is missing or invalid
 * - NEVER shows a broken blank section
 * - Distinct marker states with color-blind accessible icons: ✓ NORMAL, ⚠ SENSOR FAULT, ⛈ WEATHER EVENT, ? UNCERTAIN
 * - Geodesic Spatial Buddy lines & Weather Event radius overlays
 * - Multi-criteria filter engine (status, health range, anomaly type, region)
 * - Station search & auto-centering
 * - Map / Satellite toggles and network recentering
 */

class SkyGuardMap {
  constructor(containerId, onStationSelect) {
    this.containerId = containerId;
    this.onStationSelect = onStationSelect;
    
    // Core map state
    this.activeProvider = null; // 'google' or 'leaflet'
    this.googleMap = null;
    this.leafletMap = null;
    this.stations = [];
    this.evaluations = {};
    
    // Marker registries
    this.googleMarkers = {};
    this.leafletMarkers = {};
    this.googlePolylines = [];
    this.leafletPolylines = [];
    this.googleCircle = null;
    this.leafletCircle = null;
    this.radarLayer = null;
    this.isRadarActive = false;
    
    // Active filters
    this.activeFilters = {
      status: 'ALL',
      health: 'ALL',
      anomalyType: 'ALL',
      region: 'ALL'
    };
    
    this.apiKey = this.detectApiKey();
    this.initMap();
  }

  detectApiKey() {
    const DEFAULT_KEY = "AIzaSyAOVYRIgupAurZup5y1PRh8Ismb1A3lLao";
    // Check multiple environments for Google Maps API Key
    if (typeof window !== 'undefined') {
      if (window.VITE_GOOGLE_MAPS_API_KEY && window.VITE_GOOGLE_MAPS_API_KEY !== 'YOUR_KEY_HERE') {
        return window.VITE_GOOGLE_MAPS_API_KEY;
      }
      if (window.GOOGLE_MAPS_API_KEY && window.GOOGLE_MAPS_API_KEY !== 'YOUR_KEY_HERE') {
        return window.GOOGLE_MAPS_API_KEY;
      }
      const localKey = localStorage.getItem('VITE_GOOGLE_MAPS_API_KEY');
      if (localKey && localKey.trim() !== '') return localKey.trim();
      
      const searchParams = new URLSearchParams(window.location.search);
      const urlKey = searchParams.get('gkey') || searchParams.get('key');
      if (urlKey && urlKey.trim() !== '') return urlKey.trim();
    }
    return DEFAULT_KEY;
  }

  setApiKey(key) {
    if (key && key.trim() !== '') {
      localStorage.setItem('VITE_GOOGLE_MAPS_API_KEY', key.trim());
      this.apiKey = key.trim();
      window.location.reload();
    }
  }

  initMap() {
    if (this.apiKey) {
      this.loadGoogleMapsScript()
        .then(() => {
          this.initGoogleMap();
          this.hideKeyWarning();
        })
        .catch((err) => {
          console.warn('Google Maps script failed or rejected key, falling back to Leaflet:', err);
          this.showKeyWarning("Google Maps could not be loaded. Check API key restrictions and enabled APIs. Displaying high-precision fallback demo map.");
          this.initLeafletMap();
        });
    } else {
      this.showKeyWarning("Google Maps API key not configured. Add VITE_GOOGLE_MAPS_API_KEY to enable Google Maps. Displaying interactive fallback demo map.");
      this.initLeafletMap();
    }
  }

  showKeyWarning(message) {
    const banner = document.getElementById('map-key-warning');
    if (banner) {
      banner.style.display = 'flex';
      const textEl = banner.querySelector('.key-warning-text');
      if (textEl) textEl.textContent = message;
    }
  }

  hideKeyWarning() {
    const banner = document.getElementById('map-key-warning');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  loadGoogleMapsScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) {
        resolve();
        return;
      }

      window.gm_authFailure = () => {
        console.warn('Google Maps authentication failure callback triggered.');
        this.showKeyWarning("Google Maps API key rejected or invalid. Displaying interactive fallback demo map.");
        this.initLeafletMap();
      };

      const existingScript = document.getElementById('google-maps-sdk');
      if (existingScript) existingScript.remove();

      const script = document.createElement('script');
      script.id = 'google-maps-sdk';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&libraries=places,marker,geometry&v=weekly`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }

  // =========================================================================
  // GOOGLE MAPS IMPLEMENTATION
  // =========================================================================
  initGoogleMap() {
    this.activeProvider = 'google';
    const container = document.getElementById(this.containerId);
    if (!container) return;
    container.innerHTML = '';

    // Dark sleek command center theme for Google Maps
    const darkStyle = [
      { elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#020617' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#00f5d4' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f172a' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#030712' }] },
      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#38bdf8' }] }
    ];

    this.googleMap = new google.maps.Map(container, {
      center: { lat: 18.5, lng: 84.5 },
      zoom: 6,
      styles: darkStyle,
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      backgroundColor: '#0b1120'
    });

    this.updateProviderBadge('Google Maps Engine (Active)');
    if (this.stations.length > 0) {
      this.renderStations(this.stations, this.evaluations);
    }
  }

  // =========================================================================
  // LEAFLET FALLBACK IMPLEMENTATION (NEVER BLANK)
  // =========================================================================
  initLeafletMap() {
    this.activeProvider = 'leaflet';
    const container = document.getElementById(this.containerId);
    if (!container) return;
    container.innerHTML = '';

    this.leafletMap = L.map(this.containerId, {
      center: [18.5, 84.5],
      zoom: 6,
      zoomControl: false,
      attributionControl: false
    });

    // Dark Carto Tile Layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      subdomains: 'abcd'
    }).addTo(this.leafletMap);

    this.updateProviderBadge('Fallback Demo Map Engine (Active)');
    if (this.stations.length > 0) {
      this.renderStations(this.stations, this.evaluations);
    }
  }

  updateProviderBadge(text) {
    const badge = document.getElementById('map-provider-badge');
    if (badge) badge.textContent = text;
  }

  // =========================================================================
  // MARKER CREATION WITH COLOR-BLIND ACCESSIBLE ICONS
  // =========================================================================
  getMarkerConfig(verdict) {
    switch (verdict) {
      case 'SENSOR_FAULT':
        return {
          symbol: '⚠',
          label: 'FAULT',
          color: '#ef4444',
          bg: 'rgba(239, 68, 68, 0.2)',
          border: '#ef4444',
          shapeClass: 'marker-fault',
          shadow: '0 0 16px rgba(239, 68, 68, 0.8)'
        };
      case 'WEATHER_EVENT':
        return {
          symbol: '⛈',
          label: 'WEATHER',
          color: '#00f5d4',
          bg: 'rgba(0, 245, 212, 0.25)',
          border: '#00f5d4',
          shapeClass: 'marker-event',
          shadow: '0 0 20px rgba(0, 245, 212, 0.9)'
        };
      case 'UNCERTAIN':
        return {
          symbol: '?',
          label: 'REVIEW',
          color: '#c084fc',
          bg: 'rgba(192, 132, 252, 0.2)',
          border: '#c084fc',
          shapeClass: 'marker-uncertain',
          shadow: '0 0 16px rgba(192, 132, 252, 0.7)'
        };
      default: // NORMAL
        return {
          symbol: '✓',
          label: 'NORMAL',
          color: '#10b981',
          bg: 'rgba(16, 185, 129, 0.2)',
          border: '#10b981',
          shapeClass: 'marker-normal',
          shadow: '0 0 14px rgba(16, 185, 129, 0.6)'
        };
    }
  }

  createMarkerDomElement(station, evalData) {
    const verdict = evalData.verdict || 'NORMAL';
    const cfg = this.getMarkerConfig(verdict);
    const reading = evalData.reading || {};
    const tVal = reading.temperature !== null && reading.temperature !== undefined ? `${reading.temperature}°C` : '--';

    const el = document.createElement('div');
    el.className = `command-marker ${cfg.shapeClass}`;
    el.setAttribute('data-station-id', station.station_id);
    el.innerHTML = `
      <div class="marker-pulse-ring" style="border-color: ${cfg.border};"></div>
      <div class="marker-badge-core" style="background: ${cfg.bg}; border-color: ${cfg.border}; box-shadow: ${cfg.shadow};">
        <span class="marker-symbol">${cfg.symbol}</span>
        <span class="marker-code">${station.code}</span>
      </div>
      <div class="marker-temp-tag" style="border-color: ${cfg.border}; color: ${cfg.color};">${tVal}</div>
    `;

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onStationSelect) this.onStationSelect(station.station_id);
    });

    return el;
  }

  // =========================================================================
  // RENDER STATIONS (UNIFIED DISPATCHER)
  // =========================================================================
  renderStations(stations, evaluations) {
    this.stations = stations;
    this.evaluations = evaluations;

    if (this.activeProvider === 'google' && this.googleMap) {
      this.renderGoogleMarkers(stations, evaluations);
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      this.renderLeafletMarkers(stations, evaluations);
    }
  }

  renderGoogleMarkers(stations, evaluations) {
    stations.forEach(station => {
      const sid = station.station_id;
      const evalData = evaluations[sid] || {};
      const verdict = evalData.verdict || 'NORMAL';
      const cfg = this.getMarkerConfig(verdict);
      const isVisible = this.checkFilterVisibility(station, evalData);

      if (this.googleMarkers[sid]) {
        // Update existing marker
        this.googleMarkers[sid].setVisible(isVisible);
      } else {
        // Create custom SVG Pin Marker for Google Maps
        const markerSvg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">
            <defs>
              <filter id="glow-${sid}" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${cfg.color}" flood-opacity="0.8"/>
              </filter>
            </defs>
            <path d="M19 0 C8.5 0 0 8.5 0 19 C0 32 19 46 19 46 C19 46 38 32 38 19 C38 8.5 29.5 0 19 0 Z" fill="#0b1120" stroke="${cfg.border}" stroke-width="2.5" filter="url(#glow-${sid})"/>
            <circle cx="19" cy="18" r="13" fill="${cfg.bg}"/>
            <text x="19" y="16" font-family="Outfit, sans-serif" font-weight="bold" font-size="11" fill="#ffffff" text-anchor="middle">${station.code}</text>
            <text x="19" y="26" font-family="Inter, sans-serif" font-weight="bold" font-size="9" fill="${cfg.color}" text-anchor="middle">${cfg.symbol}</text>
          </svg>
        `;

        const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(markerSvg);

        const marker = new google.maps.Marker({
          position: { lat: station.latitude, lng: station.longitude },
          map: this.googleMap,
          title: `${station.name} (${station.code}) - ${verdict}`,
          icon: {
            url: iconUrl,
            scaledSize: new google.maps.Size(38, 46),
            anchor: new google.maps.Point(19, 46)
          },
          visible: isVisible
        });

        marker.addListener('click', () => {
          if (this.onStationSelect) this.onStationSelect(sid);
        });

        this.googleMarkers[sid] = marker;
      }
    });
  }

  renderLeafletMarkers(stations, evaluations) {
    stations.forEach(station => {
      const sid = station.station_id;
      const evalData = evaluations[sid] || {};
      const isVisible = this.checkFilterVisibility(station, evalData);
      const domEl = this.createMarkerDomElement(station, evalData);

      const customIcon = L.divIcon({
        className: 'empty-leaflet-wrapper',
        html: domEl,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });

      if (this.leafletMarkers[sid]) {
        this.leafletMarkers[sid].setIcon(customIcon);
        if (isVisible) {
          if (!this.leafletMap.hasLayer(this.leafletMarkers[sid])) {
            this.leafletMarkers[sid].addTo(this.leafletMap);
          }
        } else {
          if (this.leafletMap.hasLayer(this.leafletMarkers[sid])) {
            this.leafletMap.removeLayer(this.leafletMarkers[sid]);
          }
        }
      } else {
        const marker = L.marker([station.latitude, station.longitude], { icon: customIcon });
        if (isVisible) marker.addTo(this.leafletMap);
        this.leafletMarkers[sid] = marker;
      }
    });
  }

  // =========================================================================
  // FILTERING LOGIC
  // =========================================================================
  setFilters(filters) {
    this.activeFilters = { ...this.activeFilters, ...filters };
    this.applyFilters();
  }

  checkFilterVisibility(station, evalData) {
    const verdict = evalData.verdict || 'NORMAL';
    const health = (evalData.health && evalData.health.health_score) || 100;
    const region = station.region || 'East';
    const detectedPattern = (evalData.maintenance_recommendation && evalData.maintenance_recommendation.detected_pattern) || '';

    // Status filter
    if (this.activeFilters.status !== 'ALL') {
      if (this.activeFilters.status !== verdict) return false;
    }

    // Health filter
    if (this.activeFilters.health === '90-100' && health < 90) return false;
    if (this.activeFilters.health === '70-89' && (health < 70 || health >= 90)) return false;
    if (this.activeFilters.health === '<70' && health >= 70) return false;

    // Region filter
    if (this.activeFilters.region !== 'ALL' && this.activeFilters.region !== region) {
      return false;
    }

    // Anomaly Type filter
    if (this.activeFilters.anomalyType !== 'ALL') {
      const aType = this.activeFilters.anomalyType.toLowerCase();
      const pattern = detectedPattern.toLowerCase();
      if (!pattern.includes(aType)) return false;
    }

    return true;
  }

  applyFilters() {
    this.stations.forEach(station => {
      const sid = station.station_id;
      const evalData = this.evaluations[sid] || {};
      const isVisible = this.checkFilterVisibility(station, evalData);

      if (this.activeProvider === 'google' && this.googleMarkers[sid]) {
        this.googleMarkers[sid].setVisible(isVisible);
      } else if (this.activeProvider === 'leaflet' && this.leafletMarkers[sid]) {
        if (isVisible) {
          if (!this.leafletMap.hasLayer(this.leafletMarkers[sid])) {
            this.leafletMarkers[sid].addTo(this.leafletMap);
          }
        } else {
          if (this.leafletMap.hasLayer(this.leafletMarkers[sid])) {
            this.leafletMap.removeLayer(this.leafletMarkers[sid]);
          }
        }
      }
    });
  }

  // =========================================================================
  // STATION SELECTION, BUDDY CHECK GEODESICS & REGION OVERLAYS
  // =========================================================================
  highlightStation(stationId, neighbors = []) {
    const station = this.stations.find(s => s.station_id === stationId);
    if (!station) return;

    if (this.activeProvider === 'google' && this.googleMap) {
      this.googleMap.panTo({ lat: station.latitude, lng: station.longitude });
      this.drawGoogleBuddyLines(station, neighbors);
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      this.leafletMap.panTo([station.latitude, station.longitude], { animate: true, duration: 0.6 });
      this.drawLeafletBuddyLines(station, neighbors);
    }
  }

  drawGoogleBuddyLines(targetStation, neighbors) {
    // Clear old lines & circles
    this.googlePolylines.forEach(p => p.setMap(null));
    this.googlePolylines = [];
    if (this.googleCircle) {
      this.googleCircle.setMap(null);
      this.googleCircle = null;
    }

    if (!neighbors || neighbors.length === 0) return;

    const evalData = this.evaluations[targetStation.station_id] || {};
    const isWeather = evalData.verdict === 'WEATHER_EVENT';
    const lineColor = isWeather ? '#00f5d4' : '#f59e0b';

    neighbors.forEach(n => {
      const nStation = this.stations.find(s => s.station_id === n.station_id);
      if (nStation) {
        const polyline = new google.maps.Polyline({
          path: [
            { lat: targetStation.latitude, lng: targetStation.longitude },
            { lat: nStation.latitude, lng: nStation.longitude }
          ],
          geodesic: true,
          strokeColor: lineColor,
          strokeOpacity: 0.8,
          strokeWeight: 2,
          map: this.googleMap
        });
        this.googlePolylines.push(polyline);
      }
    });

    if (isWeather) {
      this.googleCircle = new google.maps.Circle({
        strokeColor: '#00f5d4',
        strokeOpacity: 0.8,
        strokeWeight: 1.5,
        fillColor: '#00f5d4',
        fillOpacity: 0.15,
        map: this.googleMap,
        center: { lat: targetStation.latitude, lng: targetStation.longitude },
        radius: 120000 // 120km meteorological consensus zone
      });
    }
  }

  drawLeafletBuddyLines(targetStation, neighbors) {
    this.leafletPolylines.forEach(p => this.leafletMap.removeLayer(p));
    this.leafletPolylines = [];
    if (this.leafletCircle) {
      this.leafletMap.removeLayer(this.leafletCircle);
      this.leafletCircle = null;
    }

    if (!neighbors || neighbors.length === 0) return;

    const evalData = this.evaluations[targetStation.station_id] || {};
    const isWeather = evalData.verdict === 'WEATHER_EVENT';
    const lineColor = isWeather ? '#00f5d4' : '#f59e0b';

    neighbors.forEach(n => {
      const nStation = this.stations.find(s => s.station_id === n.station_id);
      if (nStation) {
        const polyline = L.polyline(
          [[targetStation.latitude, targetStation.longitude], [nStation.latitude, nStation.longitude]],
          {
            color: lineColor,
            weight: 2,
            opacity: 0.8,
            dashArray: isWeather ? '6, 6' : '3, 6'
          }
        ).addTo(this.leafletMap);
        this.leafletPolylines.push(polyline);
      }
    });

    if (isWeather) {
      this.leafletCircle = L.circle([targetStation.latitude, targetStation.longitude], {
        radius: 120000,
        color: '#00f5d4',
        fillColor: '#00f5d4',
        fillOpacity: 0.12,
        weight: 1.5
      }).addTo(this.leafletMap);
    }
  }

  // =========================================================================
  // SEARCH & MAP CONTROLS
  // =========================================================================
  searchAndCenter(query) {
    if (!query || query.trim() === '') return false;
    const q = query.trim().toLowerCase();

    const station = this.stations.find(s => 
      s.station_id.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.district.toLowerCase().includes(q)
    );

    if (station) {
      if (this.activeProvider === 'google' && this.googleMap) {
        this.googleMap.panTo({ lat: station.latitude, lng: station.longitude });
        this.googleMap.setZoom(9);
      } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
        this.leafletMap.setView([station.latitude, station.longitude], 9);
      }
      if (this.onStationSelect) this.onStationSelect(station.station_id);
      return true;
    }
    return false;
  }

  centerOnNetwork() {
    if (this.activeProvider === 'google' && this.googleMap) {
      this.googleMap.panTo({ lat: 18.5, lng: 84.5 });
      this.googleMap.setZoom(6);
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      this.leafletMap.setView([18.5, 84.5], 6);
    }
  }

  zoomIn() {
    if (this.activeProvider === 'google' && this.googleMap) {
      this.googleMap.setZoom(this.googleMap.getZoom() + 1);
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      this.leafletMap.zoomIn();
    }
  }

  zoomOut() {
    if (this.activeProvider === 'google' && this.googleMap) {
      this.googleMap.setZoom(this.googleMap.getZoom() - 1);
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      this.leafletMap.zoomOut();
    }
  }

  toggleSatellite() {
    const btn = document.getElementById('btn-map-type');
    if (this.activeProvider === 'google' && this.googleMap) {
      const cur = this.googleMap.getMapTypeId();
      const next = cur === 'roadmap' ? 'hybrid' : 'roadmap';
      this.googleMap.setMapTypeId(next);
      if (btn) btn.textContent = next === 'hybrid' ? '🗺️ Default View' : '🛰️ Satellite';
    } else {
      if (btn) {
        btn.textContent = '🛰️ Satellite (Google Maps)';
        alert('Satellite imagery requires Google Maps API Key. Click "Set Key" to configure.');
      }
    }
  }

  toggleRadar() {
    this.isRadarActive = !this.isRadarActive;
    const btn = document.getElementById('btn-toggle-radar');

    if (this.activeProvider === 'leaflet' && this.leafletMap) {
      if (this.isRadarActive) {
        if (!this.radarLayer) {
          this.radarLayer = L.tileLayer('https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/{z}/{x}/{y}/2/1_1.png', {
            opacity: 0.65,
            maxZoom: 16
          });
        }
        this.radarLayer.addTo(this.leafletMap);
        if (btn) {
          btn.classList.add('active');
          btn.textContent = '📡 Radar: ON';
        }
      } else {
        if (this.radarLayer) this.leafletMap.removeLayer(this.radarLayer);
        if (btn) {
          btn.classList.remove('active');
          btn.textContent = '📡 Radar: OFF';
        }
      }
    } else {
      // In Google maps, simulate radar overlay
      if (btn) {
        btn.classList.toggle('active', this.isRadarActive);
        btn.textContent = this.isRadarActive ? '📡 Radar: ON' : '📡 Radar: OFF';
      }
    }
  }
}

window.SkyGuardMap = SkyGuardMap;
