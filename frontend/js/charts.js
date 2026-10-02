/**
 * Chart.js Telemetry Visualization Module for SkyGuard AI
 * Renders multi-sensor time-series (Temperature, Magnus Dew Point, Pressure, Humidity)
 * with real-time streaming updates.
 */

class SkyGuardCharts {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.chart = null;
    this.currentFilter = 'all'; // 'all', 'temp', 'pres', 'rh'
    this.initChart();
  }

  initChart() {
    const ctx = document.getElementById(this.canvasId).getContext('2d');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Ambient Temp (°C)',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'yTemp'
          },
          {
            label: 'Magnus Dew Point Td (°C)',
            data: [],
            borderColor: '#00f5d4',
            borderDash: [4, 4],
            backgroundColor: 'transparent',
            borderWidth: 1.8,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            yAxisID: 'yTemp'
          },
          {
            label: 'Pressure (hPa)',
            data: [],
            borderColor: '#00bbf9',
            backgroundColor: 'rgba(0, 187, 249, 0.08)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'yPres'
          },
          {
            label: 'Humidity (%)',
            data: [],
            borderColor: '#a855f7',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            tension: 0.3,
            pointRadius: 1,
            pointHoverRadius: 4,
            yAxisID: 'yRh'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              font: { family: 'Inter', size: 10 },
              color: '#94a3b8'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(13, 21, 39, 0.95)',
            titleFont: { family: 'Outfit', size: 12, weight: 'bold' },
            bodyFont: { family: 'JetBrains Mono', size: 11 },
            borderColor: '#2a3e6a',
            borderWidth: 1,
            padding: 10
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: {
              color: '#64748b',
              font: { family: 'JetBrains Mono', size: 9 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8
            }
          },
          yTemp: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Temp / Dew Point (°C)', color: '#f59e0b', font: { size: 10 } },
            grid: { color: 'rgba(255, 255, 255, 0.04)' },
            ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 9 } }
          },
          yPres: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'Pressure (hPa)', color: '#00bbf9', font: { size: 10 } },
            grid: { drawOnChartArea: false },
            ticks: { color: '#00bbf9', font: { family: 'JetBrains Mono', size: 9 } }
          },
          yRh: {
            type: 'linear',
            display: false,
            min: 0,
            max: 100,
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  setFilter(filterType) {
    this.currentFilter = filterType;
    if (!this.chart) return;

    if (filterType === 'all') {
      this.chart.data.datasets[0].hidden = false;
      this.chart.data.datasets[1].hidden = false;
      this.chart.data.datasets[2].hidden = false;
      this.chart.data.datasets[3].hidden = false;
      this.chart.options.scales.yTemp.display = true;
      this.chart.options.scales.yPres.display = true;
    } else if (filterType === 'temp') {
      this.chart.data.datasets[0].hidden = false;
      this.chart.data.datasets[1].hidden = false;
      this.chart.data.datasets[2].hidden = true;
      this.chart.data.datasets[3].hidden = true;
      this.chart.options.scales.yTemp.display = true;
      this.chart.options.scales.yPres.display = false;
    } else if (filterType === 'pres') {
      this.chart.data.datasets[0].hidden = true;
      this.chart.data.datasets[1].hidden = true;
      this.chart.data.datasets[2].hidden = false;
      this.chart.data.datasets[3].hidden = true;
      this.chart.options.scales.yTemp.display = false;
      this.chart.options.scales.yPres.display = true;
    } else if (filterType === 'rh') {
      this.chart.data.datasets[0].hidden = true;
      this.chart.data.datasets[1].hidden = true;
      this.chart.data.datasets[2].hidden = true;
      this.chart.data.datasets[3].hidden = false;
      this.chart.options.scales.yTemp.display = false;
      this.chart.options.scales.yPres.display = false;
    }

    this.chart.update();
  }

  updateData(history) {
    if (!this.chart || !history) return;

    const labels = history.map(item => {
      const dt = new Date(item.timestamp);
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    const temps = history.map(i => i.temperature);
    const dewPoints = history.map(i => i.dew_point);
    const pressures = history.map(i => i.pressure);
    const humidities = history.map(i => i.humidity);

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = temps;
    this.chart.data.datasets[1].data = dewPoints;
    this.chart.data.datasets[2].data = pressures;
    this.chart.data.datasets[3].data = humidities;

    this.chart.update('none'); // Update without full redraw glitch
  }
}

window.SkyGuardCharts = SkyGuardCharts;
