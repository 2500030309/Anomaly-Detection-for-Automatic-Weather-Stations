/**
 * SkyGuard AI - Unified Command Center Map Module
 * 
 * Implements:
 * - Google Maps JavaScript API with custom dark meteorological theme
 * - Resilient fallback to Leaflet Carto Dark map if API key is missing or invalid
 * - Zero hard-coded API keys in source code (configured via VITE_GOOGLE_MAPS_API_KEY, localStorage, or ?key=)
 * - NEVER shows a broken or blank section
 * - 8 Simulated Demo AWS Stations (AWS-001 through AWS-008)
 * - Distinct marker states with color-blind accessible icons:
 *     ✓ NORMAL
 *     ⚠ SENSOR FAULT
 *     ⛈ WEATHER EVENT
 *     ? UNCERTAIN
 * - Dynamic marker state updates during live simulation / sandbox injections
 * - Interactive Google Maps InfoWindow with meteorological parameters, detection evidence, and "VIEW FULL 4-LAYER ANALYSIS" action
 * - Multi-criteria filter engine (status, health range, anomaly type, region)
 * - Station search with auto-centering, zoom, and InfoWindow presentation
 * - Center on Network (bounds fit for all 8 stations)
 * - Map / Satellite toggles (google.maps.MapTypeId.HYBRID vs dark ROADMAP)
 * - Radar DEMO overlay with transparent labeling
 * - Spatial Buddy Check geodesics (<250 km) and Demo Weather Event spatial overlays
 */

class SkyGuardMap {
  constructor(containerId, onStationSelect) {
    this.containerId = containerId;
    this.onStationSelect = onStationSelect;
    window.SkyGuardActiveMap = this;
    
    // Core map state
    this.activeProvider = null; // 'google' or 'leaflet'
    this.googleMap = null;
    this.leafletMap = null;
    this.stations = [];
    this.evaluations = {};
    this.selectedStationId = null;
    this.currentInfoWindowStationId = null;
    
    // Google Maps registries
    this.googleMarkers = {};
    this.googleInfoWindow = null;
    this.googlePolylines = [];
    this.googleCircle = null;
    this.googleRadarLayer = null;
    
    // Leaflet registries
    this.leafletMarkers = {};
    this.leafletPolylines = [];
    this.leafletCircle = null;
    this.leafletRadarLayer = null;
    
    this.isRadarActive = false;
    
    // Dark command center theme for Google Maps
    this.darkStyle = [
      { elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#020617' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#00f5d4' }] },
      { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#334155' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0f172a' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#030712' }] },
      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#38bdf8' }] }
    ];

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

  /**
   * Detects the Google Maps API Key from environment or storage.
   * NOTE: The API key is NOT hardcoded into source code.
   */
  detectApiKey() {
    if (typeof window !== 'undefined') {
      // 1. Build environment variable (if passed by build pipeline and not a template placeholder)
      if (window.VITE_GOOGLE_MAPS_API_KEY && 
          window.VITE_GOOGLE_MAPS_API_KEY !== 'YOUR_KEY_HERE' && 
          !window.VITE_GOOGLE_MAPS_API_KEY.includes('YOUR_')) {
        return window.VITE_GOOGLE_MAPS_API_KEY.trim();
      }
      if (window.GOOGLE_MAPS_API_KEY && 
          window.GOOGLE_MAPS_API_KEY !== 'YOUR_KEY_HERE' && 
          !window.GOOGLE_MAPS_API_KEY.includes('YOUR_')) {
        return window.GOOGLE_MAPS_API_KEY.trim();
      }

      // 2. User-entered key stored in localStorage via the UI modal
      const localKey = window.localStorage ? window.localStorage.getItem('VITE_GOOGLE_MAPS_API_KEY') : null;
      if (localKey && localKey.trim() !== '') {
        return localKey.trim();
      }
      
      // 3. Optional URL query parameter (?key=... or ?gkey=...)
      const searchParams = new URLSearchParams(window.location.search);
      const urlKey = searchParams.get('key') || searchParams.get('gkey');
      if (urlKey && urlKey.trim() !== '') {
        return urlKey.trim();
      }
    }
    return null;
  }

  setApiKey(key) {
    if (key && key.trim() !== '') {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('VITE_GOOGLE_MAPS_API_KEY', key.trim());
      }
      this.apiKey = key.trim();
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
    }
  }

  clearApiKey() {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('VITE_GOOGLE_MAPS_API_KEY');
    }
    this.apiKey = null;
    if (typeof window !== 'undefined' && window.location) {
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
          console.warn('Google Maps script failed or key rejected. Falling back to demo map:', err);
          this.showKeyWarning("Google Maps could not be loaded. Check your API key and Google Cloud restrictions.");
          this.initLeafletMap();
        });
    } else {
      this.showKeyWarning("Google Maps API key not configured. Add VITE_GOOGLE_MAPS_API_KEY to enable Google Maps.");
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
        this.showKeyWarning("Google Maps could not be loaded. Check your API key and Google Cloud restrictions.");
        this.initLeafletMap();
      };

      const existingScript = document.getElementById('google-maps-sdk');
      if (existingScript) existingScript.remove();

      const script = document.createElement('script');
      script.id = 'google-maps-sdk';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(this.apiKey)}&libraries=marker,geometry&v=weekly`;
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

    this.googleMap = new google.maps.Map(container, {
      center: { lat: 18.5, lng: 84.5 },
      zoom: 6,
      styles: this.darkStyle,
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      backgroundColor: '#0b1120'
    });

    // Create single shared InfoWindow for Google Maps
    this.googleInfoWindow = new google.maps.InfoWindow({
      minWidth: 290,
      maxWidth: 350
    });

    this.googleInfoWindow.addListener('closeclick', () => {
      this.currentInfoWindowStationId = null;
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
  // MARKER CONFIGURATION WITH COLOR-BLIND ACCESSIBLE ICONS
  // =========================================================================
  getMarkerConfig(verdict) {
    switch (verdict) {
      case 'SENSOR_FAULT':
        return {
          symbol: '⚠',
          label: 'FAULT',
          color: '#ef4444',
          bg: 'rgba(239, 68, 68, 0.25)',
          border: '#ef4444',
          shapeClass: 'marker-fault',
          shadow: '0 0 16px rgba(239, 68, 68, 0.85)'
        };
      case 'WEATHER_EVENT':
        return {
          symbol: '⛈',
          label: 'WEATHER',
          color: '#00f5d4',
          bg: 'rgba(0, 245, 212, 0.28)',
          border: '#00f5d4',
          shapeClass: 'marker-event',
          shadow: '0 0 20px rgba(0, 245, 212, 0.95)'
        };
      case 'UNCERTAIN':
        return {
          symbol: '?',
          label: 'REVIEW',
          color: '#c084fc',
          bg: 'rgba(192, 132, 252, 0.25)',
          border: '#c084fc',
          shapeClass: 'marker-uncertain',
          shadow: '0 0 16px rgba(192, 132, 252, 0.75)'
        };
      default: // NORMAL
        return {
          symbol: '✓',
          label: 'NORMAL',
          color: '#10b981',
          bg: 'rgba(16, 185, 129, 0.22)',
          border: '#10b981',
          shapeClass: 'marker-normal',
          shadow: '0 0 14px rgba(16, 185, 129, 0.65)'
        };
    }
  }

  generateMarkerSvg(station, cfg) {
    const sid = station.station_id;
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">
        <defs>
          <filter id="glow-${sid}" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${cfg.color}" flood-opacity="0.85"/>
          </filter>
        </defs>
        <path d="M19 0 C8.5 0 0 8.5 0 19 C0 32 19 46 19 46 C19 46 38 32 38 19 C38 8.5 29.5 0 19 0 Z" fill="#0b1120" stroke="${cfg.border}" stroke-width="2.5" filter="url(#glow-${sid})"/>
        <circle cx="19" cy="18" r="13" fill="${cfg.bg}"/>
        <text x="19" y="16" font-family="'Outfit', sans-serif" font-weight="700" font-size="10.5" fill="#ffffff" text-anchor="middle">${station.code}</text>
        <text x="19" y="26" font-family="'Inter', sans-serif" font-weight="700" font-size="9" fill="${cfg.color}" text-anchor="middle">${cfg.symbol}</text>
      </svg>
    `;
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
      this.handleStationClick(station.station_id);
    });

    return el;
  }

  // =========================================================================
  // UNIFIED STATION INFORMATION CARD HTML (GOOGLE MAPS & LEAFLET)
  // =========================================================================
  buildStationInfoHtml(station, evalData) {
    const verdict = evalData.verdict || 'NORMAL';
    const cfg = this.getMarkerConfig(verdict);
    const reading = evalData.reading || {};
    const healthScore = evalData.health_score !== undefined ? evalData.health_score : ((evalData.health && evalData.health.health_score) || 100);
    const confidence = evalData.confidence !== undefined ? evalData.confidence : 95.0;
    
    const tVal = reading.temperature !== null && reading.temperature !== undefined ? `${reading.temperature} °C` : 'N/A';
    const pVal = reading.pressure !== null && reading.pressure !== undefined ? `${reading.pressure} hPa` : 'N/A';
    const rhVal = reading.humidity !== null && reading.humidity !== undefined ? `${reading.humidity} %` : 'N/A';
    const tdVal = reading.dew_point !== null && reading.dew_point !== undefined ? `${reading.dew_point} °C` : 'N/A';
    
    let timeStr = 'Just Now';
    if (reading.timestamp) {
      try {
        const d = new Date(reading.timestamp);
        timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      } catch (e) {
        timeStr = reading.timestamp;
      }
    }

    // Evidence checklist items
    const checklist = evalData.evidence_checklist || [
      { text: "Physical limits & bounds verified", pass: true },
      { text: "Temporal change rate nominal", pass: true },
      { text: "Thermodynamic invariant (Td ≤ T) consistent", pass: true },
      { text: "Neighboring stations spatial consensus confirmed", pass: true }
    ];

    const evidenceHtml = checklist.map(item => `
      <li style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; color: ${item.pass ? '#10b981' : '#ef4444'};">
        <span>${item.pass ? '✓' : '⚠'}</span>
        <span style="color: #cbd5e1;">${item.text}</span>
      </li>
    `).join('');

    const actionText = (evalData.maintenance_recommendation && evalData.maintenance_recommendation.action) ||
      (verdict === 'WEATHER_EVENT' ? 'Continue regional meteorological monitoring.' :
       verdict === 'SENSOR_FAULT' ? 'Inspect affected sensor and dispatch recalibration team.' :
       verdict === 'UNCERTAIN' ? 'Flagged for human-in-the-loop meteorologist review.' :
       'Nominal operation. Routine scheduled check.');

    return `
      <div class="gmap-station-infocard" style="font-family: 'Inter', sans-serif; color: #f8fafc; line-height: 1.4; padding: 4px;">
        <div style="border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 8px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="font-family: 'JetBrains Mono', monospace; font-size: 14px; color: #00f5d4;">${station.station_id}</strong>
            <span style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">${station.region} Corridor</span>
          </div>
          <div style="font-family: 'Outfit', sans-serif; font-size: 13px; font-weight: 700; color: #ffffff; text-transform: uppercase; margin-top: 2px;">
            ${station.name}
          </div>
          <div style="font-size: 10px; color: #64748b; font-family: monospace;">
            ${station.latitude.toFixed(4)}°N, ${station.longitude.toFixed(4)}°E &bull; Elev: ${station.elevation_m || 25}m
          </div>
        </div>

        <div style="background: ${cfg.bg}; border: 1px solid ${cfg.border}; border-radius: 6px; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 10px; font-weight: 700; color: #cbd5e1; text-transform: uppercase;">Current Verdict:</span>
          <strong style="color: ${cfg.color}; font-size: 12px; display: flex; align-items: center; gap: 4px;">
            <span>${cfg.symbol}</span> ${verdict}
          </strong>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; font-size: 11px;">
          <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); padding: 5px 8px; border-radius: 5px;">
            <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase;">Health Index</div>
            <strong style="color: #00f5d4; font-size: 13px;">${healthScore}%</strong>
          </div>
          <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); padding: 5px 8px; border-radius: 5px;">
            <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase;">Confidence</div>
            <strong style="color: #10b981; font-size: 13px;">${confidence}%</strong>
          </div>
          <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); padding: 5px 8px; border-radius: 5px;">
            <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase;">Temperature</div>
            <strong style="color: #f59e0b; font-size: 13px;">${tVal}</strong>
          </div>
          <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); padding: 5px 8px; border-radius: 5px;">
            <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase;">Pressure</div>
            <strong style="color: #38bdf8; font-size: 13px;">${pVal}</strong>
          </div>
          <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); padding: 5px 8px; border-radius: 5px;">
            <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase;">Humidity</div>
            <strong style="color: #2dd4bf; font-size: 13px;">${rhVal}</strong>
          </div>
          <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); padding: 5px 8px; border-radius: 5px;">
            <div style="font-size: 9px; color: #94a3b8; text-transform: uppercase;">Dew Point</div>
            <strong style="color: #c084fc; font-size: 13px;">${tdVal}</strong>
          </div>
        </div>

        <div style="font-size: 10px; color: #64748b; margin-bottom: 8px;">
          Last Telemetry Update: <strong style="color: #cbd5e1;">${timeStr}</strong>
        </div>

        <div style="background: rgba(15,23,42,0.6); border-radius: 6px; padding: 6px 8px; margin-bottom: 8px;">
          <div style="font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Detection Evidence</div>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${evidenceHtml}
          </ul>
        </div>

        <div style="font-size: 11px; margin-bottom: 10px; background: rgba(0,0,0,0.3); padding: 6px 8px; border-left: 3px solid ${cfg.border}; border-radius: 0 4px 4px 0;">
          <span style="font-size: 9px; color: #94a3b8; text-transform: uppercase; display: block;">Decision &bull; Action</span>
          <span style="color: #e2e8f0; font-size: 11px;">${actionText}</span>
        </div>

        <button 
          style="width: 100%; padding: 8px 12px; background: #00f5d4; color: #020617; border: none; border-radius: 6px; font-weight: 700; font-size: 11px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: transform 0.15s ease;"
          onmouseover="this.style.opacity='0.9'"
          onmouseout="this.style.opacity='1'"
          onclick="window.SkyGuardActiveMap && window.SkyGuardActiveMap.handleViewAnalysis('${station.station_id}')"
        >
          VIEW FULL 4-LAYER ANALYSIS &rarr;
        </button>
      </div>
    `;
  }

  handleViewAnalysis(stationId) {
    if (this.onStationSelect) {
      this.onStationSelect(stationId);
    }
    // Smoothly scroll down towards the 4-layer inspection details if on mobile/small screen
    const targetEl = document.getElementById('selected-station-card') || document.getElementById('pipeline-flow-diagram');
    if (targetEl && window.innerWidth < 1024) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  handleStationClick(stationId) {
    this.selectedStationId = stationId;
    const station = this.stations.find(s => s.station_id === stationId);
    if (!station) return;

    if (this.activeProvider === 'google' && this.googleMap) {
      const marker = this.googleMarkers[stationId];
      if (marker) {
        this.openGoogleInfoWindow(station, marker);
      }
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      const marker = this.leafletMarkers[stationId];
      if (marker) {
        marker.openPopup();
      }
    }

    if (this.onStationSelect) {
      this.onStationSelect(stationId);
    }
  }

  openGoogleInfoWindow(station, marker) {
    const sid = station.station_id;
    this.currentInfoWindowStationId = sid;
    const evalData = this.evaluations[sid] || {};
    const html = this.buildStationInfoHtml(station, evalData);

    if (this.googleInfoWindow && this.googleMap) {
      this.googleInfoWindow.setContent(html);
      this.googleInfoWindow.open({
        map: this.googleMap,
        anchor: marker,
        shouldFocus: false
      });
    }
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

    // Refresh buddy lines if a station is currently selected
    if (this.selectedStationId) {
      const selStation = this.stations.find(s => s.station_id === this.selectedStationId);
      if (selStation) {
        const evalData = this.evaluations[this.selectedStationId] || {};
        const neighbors = (evalData.layers && evalData.layers.l4_spatial && evalData.layers.l4_spatial.neighbors) || [];
        if (this.activeProvider === 'google') {
          this.drawGoogleBuddyLines(selStation, neighbors);
        } else {
          this.drawLeafletBuddyLines(selStation, neighbors);
        }
      }
    }
  }

  renderGoogleMarkers(stations, evaluations) {
    stations.forEach(station => {
      const sid = station.station_id;
      const evalData = evaluations[sid] || {};
      const verdict = evalData.verdict || 'NORMAL';
      const cfg = this.getMarkerConfig(verdict);
      const isVisible = this.checkFilterVisibility(station, evalData);
      
      const markerSvg = this.generateMarkerSvg(station, cfg);
      const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(markerSvg);

      const iconObj = {
        url: iconUrl,
        scaledSize: new google.maps.Size(38, 46),
        anchor: new google.maps.Point(19, 46)
      };

      if (this.googleMarkers[sid]) {
        // UPDATE EXISTING MARKER: icon, title, visibility in real time
        const marker = this.googleMarkers[sid];
        marker.setIcon(iconObj);
        marker.setTitle(`${station.name} (${station.code}) - ${verdict}`);
        marker.setVisible(isVisible);

        // If InfoWindow is currently open for this station, update its live data!
        if (this.currentInfoWindowStationId === sid && this.googleInfoWindow) {
          this.googleInfoWindow.setContent(this.buildStationInfoHtml(station, evalData));
        }
      } else {
        // CREATE NEW MARKER
        const marker = new google.maps.Marker({
          position: { lat: station.latitude, lng: station.longitude },
          map: this.googleMap,
          title: `${station.name} (${station.code}) - ${verdict}`,
          icon: iconObj,
          visible: isVisible
        });

        marker.addListener('click', () => {
          this.handleStationClick(sid);
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
      const popupHtml = this.buildStationInfoHtml(station, evalData);

      const customIcon = L.divIcon({
        className: 'empty-leaflet-wrapper',
        html: domEl,
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      });

      if (this.leafletMarkers[sid]) {
        this.leafletMarkers[sid].setIcon(customIcon);
        this.leafletMarkers[sid].setPopupContent(popupHtml);
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
        marker.bindPopup(popupHtml, { minWidth: 290, maxWidth: 350 });
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
    const health = evalData.health_score !== undefined ? evalData.health_score : ((evalData.health && evalData.health.health_score) || 100);
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
        // If the open InfoWindow is for a station now hidden, close it
        if (!isVisible && this.currentInfoWindowStationId === sid && this.googleInfoWindow) {
          this.googleInfoWindow.close();
          this.currentInfoWindowStationId = null;
        }
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
    this.selectedStationId = stationId;
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
          strokeOpacity: isWeather ? 0.9 : 0.75,
          strokeWeight: isWeather ? 2.5 : 1.8,
          map: this.googleMap
        });
        this.googlePolylines.push(polyline);
      }
    });

    if (isWeather) {
      this.googleCircle = new google.maps.Circle({
        strokeColor: '#00f5d4',
        strokeOpacity: 0.85,
        strokeWeight: 1.5,
        fillColor: '#00f5d4',
        fillOpacity: 0.12,
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
            weight: isWeather ? 2.5 : 1.8,
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
      (s.district && s.district.toLowerCase().includes(q))
    );

    if (station) {
      const sid = station.station_id;
      this.selectedStationId = sid;

      if (this.activeProvider === 'google' && this.googleMap) {
        this.googleMap.panTo({ lat: station.latitude, lng: station.longitude });
        this.googleMap.setZoom(10);
        const marker = this.googleMarkers[sid];
        if (marker) {
          this.openGoogleInfoWindow(station, marker);
        }
      } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
        this.leafletMap.setView([station.latitude, station.longitude], 10);
        const marker = this.leafletMarkers[sid];
        if (marker) {
          marker.openPopup();
        }
      }

      if (this.onStationSelect) {
        this.onStationSelect(sid);
      }
      return true;
    }
    return false;
  }

  centerOnNetwork() {
    if (this.stations.length === 0) return;

    if (this.activeProvider === 'google' && this.googleMap) {
      const bounds = new google.maps.LatLngBounds();
      this.stations.forEach(s => {
        bounds.extend({ lat: s.latitude, lng: s.longitude });
      });
      this.googleMap.fitBounds(bounds, { top: 60, bottom: 60, left: 60, right: 60 });
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      const latlngs = this.stations.map(s => [s.latitude, s.longitude]);
      this.leafletMap.fitBounds(latlngs, { padding: [50, 50] });
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
      const curType = this.googleMap.getMapTypeId();
      const isHybrid = curType === 'hybrid' || curType === google.maps.MapTypeId.HYBRID;
      const nextType = isHybrid ? google.maps.MapTypeId.ROADMAP : google.maps.MapTypeId.HYBRID;
      
      this.googleMap.setMapTypeId(nextType);
      if (nextType === google.maps.MapTypeId.ROADMAP) {
        this.googleMap.setOptions({ styles: this.darkStyle });
      }

      if (btn) {
        btn.textContent = nextType === google.maps.MapTypeId.HYBRID ? '🗺️ Dark Map' : '🛰️ Satellite';
      }
    } else {
      if (btn) {
        btn.textContent = '🛰️ Satellite';
        alert('Satellite imagery layer is available with Google Maps. Enter a valid Google Maps API Key in "Maps Key" to enable.');
      }
    }
  }

  toggleRadar() {
    this.isRadarActive = !this.isRadarActive;
    const btn = document.getElementById('btn-toggle-radar');

    if (this.activeProvider === 'google' && this.googleMap) {
      if (!this.googleRadarLayer) {
        this.googleRadarLayer = new google.maps.ImageMapType({
          getTileUrl: function(coord, zoom) {
            return `https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/${zoom}/${coord.x}/${coord.y}/2/1_1.png`;
          },
          tileSize: new google.maps.Size(256, 256),
          opacity: 0.65,
          name: "RadarDemo"
        });
      }

      if (this.isRadarActive) {
        this.googleMap.overlayMapTypes.push(this.googleRadarLayer);
        if (btn) {
          btn.classList.add('active');
          btn.textContent = '📡 Radar: DEMO (ON)';
        }
      } else {
        this.googleMap.overlayMapTypes.clear();
        if (btn) {
          btn.classList.remove('active');
          btn.textContent = '📡 Radar: OFF';
        }
      }
    } else if (this.activeProvider === 'leaflet' && this.leafletMap) {
      if (this.isRadarActive) {
        if (!this.leafletRadarLayer) {
          this.leafletRadarLayer = L.tileLayer('https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/{z}/{x}/{y}/2/1_1.png', {
            opacity: 0.65,
            maxZoom: 16
          });
        }
        this.leafletRadarLayer.addTo(this.leafletMap);
        if (btn) {
          btn.classList.add('active');
          btn.textContent = '📡 Radar: DEMO (ON)';
        }
      } else {
        if (this.leafletRadarLayer) {
          this.leafletMap.removeLayer(this.leafletRadarLayer);
        }
        if (btn) {
          btn.classList.remove('active');
          btn.textContent = '📡 Radar: OFF';
        }
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window.SkyGuardMap = SkyGuardMap;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SkyGuardMap;
}
