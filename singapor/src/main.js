import './style.css';
import ApexCharts from 'apexcharts';

// ==========================================
// STATE MANAGEMENT & DATA DEFINITIONS
// ==========================================

const State = {
  selectedLocation: 'all', // 'all', 'north_wing', 'south_plaza', 'food_court', 'fashion_hub'
  selectedTimeView: 'hourly', // 'hourly', 'daily'
  simHour: 0,
  simMinute: 0,
  simSpeed: 2, // 0: paused, 1: slow, 2: normal, 3: fast, 4: hyper
  simProfile: 'weekday', // 'weekday', 'weekend', 'holiday'
  crowdMultiplier: 1.0,
  activeImpulse: null,

  // Real-time accumulating values (start at 0 for pure live video analytics)
  cumulativeHeadcounts: {
    all: 0,
    north_wing: 0,
    south_plaza: 0,
    food_court: 0,
    fashion_hub: 0
  },

  // Active occupancy (start at 0 for pure live video analytics)
  liveOccupancies: {
    north_wing: 0,
    south_plaza: 0,
    food_court: 0,
    fashion_hub: 0
  }
};

// Location details
const LocationMeta = {
  all: { name: 'Singapore Mall (All Zones)', capacity: 150, dwellBase: 80 },
  north_wing: { name: 'North Wing (Retail & Dining)', capacity: 40, dwellBase: 65 },
  south_plaza: { name: 'South Plaza (Event & Entertainment)', capacity: 50, dwellBase: 90 },
  food_court: { name: 'Food Court (Level 3)', capacity: 30, dwellBase: 45 },
  fashion_hub: { name: 'Fashion Hub (Level 1-2)', capacity: 30, dwellBase: 75 }
};

// Fallback baseline Demographic structures (used only if video telemetry is not loaded)
const DemoProfiles = {
  all: { sex: [0, 0, 0], age: [0, 0, 0, 0, 0], ethnicity: [0, 0, 0, 0] },
  north_wing: { sex: [0, 0, 0], age: [0, 0, 0, 0, 0], ethnicity: [0, 0, 0, 0] },
  south_plaza: { sex: [0, 0, 0], age: [0, 0, 0, 0, 0], ethnicity: [0, 0, 0, 0] },
  food_court: { sex: [0, 0, 0], age: [0, 0, 0, 0, 0], ethnicity: [0, 0, 0, 0] },
  fashion_hub: { sex: [0, 0, 0], age: [0, 0, 0, 0, 0], ethnicity: [0, 0, 0, 0] }
};

// Hourly footfall profile curves (0.0 to 1.0)
const HourlyProfiles = {
  weekday: [
    0.02, 0.01, 0.01, 0.01, 0.02, 0.05, 0.12, 0.22, 0.35, 0.45, 0.52, 0.65,
    0.85, 0.78, 0.58, 0.62, 0.70, 0.82, 0.95, 0.88, 0.68, 0.42, 0.18, 0.06
  ],
  weekend: [
    0.04, 0.02, 0.01, 0.01, 0.01, 0.04, 0.08, 0.15, 0.30, 0.50, 0.68, 0.85,
    0.98, 0.95, 0.88, 0.85, 0.88, 0.92, 0.99, 0.95, 0.82, 0.58, 0.32, 0.12
  ],
  holiday: [
    0.05, 0.02, 0.01, 0.01, 0.01, 0.03, 0.06, 0.18, 0.38, 0.62, 0.82, 0.95,
    1.00, 0.98, 0.94, 0.92, 0.94, 0.98, 1.00, 0.96, 0.88, 0.65, 0.38, 0.15
  ]
};

// Daily footfall multipliers
const DailyProfiles = {
  weekday: [0.85, 0.88, 0.90, 0.92, 1.10, 1.45, 1.35], // Mon - Sun
  weekend: [0.75, 0.78, 0.80, 0.82, 1.05, 1.55, 1.45], // Boosted weekends
  holiday: [1.30, 1.32, 1.28, 1.35, 1.48, 1.70, 1.62]  // Elevated entire week
};

// ==========================================
// REGISTRY & CLASSIFICATION MAPPINGS
// ==========================================

let videoStats = [];
let liveVideoPeople = new Map();
let faceFirstAppearances = new Map();
let videoDuration = 61.0;

// Map detected general race (e.g. Asian) to Singapore local profiles deterministically
function getSingaporeEthnicity(id, detectedRace) {
  if (detectedRace !== 'Asian') return 'Others';
  const hash = (id * 17) % 100;
  if (hash < 78) return 'Chinese';
  if (hash < 92) return 'Malay';
  return 'Indian';
}

// Map tracked person ID and gender to a specific mall zone wing
function getAssignedZone(id, gender) {
  if (gender === 'Female') {
    return (id % 2 === 0) ? 'fashion_hub' : 'food_court';
  } else {
    return (id % 2 === 0) ? 'south_plaza' : 'north_wing';
  }
}

// Calculate the first appearance timestamp for each person ID in the JSON
function calculateFirstAppearances() {
  faceFirstAppearances.clear();
  videoStats.forEach(frame => {
    if (frame.detections) {
      frame.detections.forEach(det => {
        if (!faceFirstAppearances.has(det.id)) {
          faceFirstAppearances.set(det.id, frame.timestamp);
        }
      });
    }
  });
}

// ==========================================
// APEXCHARTS INITIALIZATION
// ==========================================

let trafficChart, sexChart, ageChart, ethnicityChart;

function initCharts() {
  const trafficOptions = {
    chart: {
      type: 'area',
      height: 300,
      background: 'transparent',
      toolbar: { show: false },
      zoom: { enabled: false },
      foreColor: '#94a3b8',
      fontFamily: 'Inter, sans-serif'
    },
    colors: ['#6366f1', '#06b6d4'],
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 3 },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.45,
        opacityTo: 0.05,
        stops: [0, 90, 100]
      }
    },
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.05)',
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } }
    },
    xaxis: {
      categories: [],
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: {
        formatter: (val) => Math.round(val)
      }
    },
    tooltip: {
      theme: 'dark',
      x: { show: true },
      marker: { show: true }
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: '#94a3b8' }
    },
    series: []
  };

  trafficChart = new ApexCharts(document.querySelector("#traffic-chart"), trafficOptions);
  trafficChart.render();

  // 2. Sex Pie/Donut Chart
  const sexOptions = {
    chart: {
      type: 'donut',
      height: 240,
      background: 'transparent',
      foreColor: '#94a3b8',
      fontFamily: 'Inter, sans-serif'
    },
    stroke: { show: false },
    colors: ['#06b6d4', '#f43f5e', '#6366f1'],
    labels: ['Male', 'Female', 'Non-binary'],
    legend: {
      position: 'bottom',
      labels: { colors: '#94a3b8' }
    },
    dataLabels: {
      enabled: true,
      dropShadow: { enabled: false },
      formatter: (val) => `${Math.round(val)}%`
    },
    plotOptions: {
      pie: {
        donut: {
          size: '72%',
          background: 'transparent',
          labels: {
            show: true,
            name: { show: true, fontSize: '0.8rem', color: '#64748b' },
            value: {
              show: true,
              fontSize: '1.6rem',
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 800,
              color: '#f8fafc',
              formatter: (val) => `${val}%`
            },
            total: {
              show: true,
              label: 'Visible',
              color: '#94a3b8',
              formatter: (w) => {
                const total = w.globals.series.reduce((a, b) => a + b, 0);
                return total > 0 ? `${total}%` : '0%';
              }
            }
          }
        }
      }
    },
    tooltip: { theme: 'dark' },
    series: [0, 0, 0]
  };

  sexChart = new ApexCharts(document.querySelector("#sex-chart"), sexOptions);
  sexChart.render();

  // 3. Age Groups Chart
  const ageOptions = {
    chart: {
      type: 'bar',
      height: 240,
      background: 'transparent',
      toolbar: { show: false },
      foreColor: '#94a3b8',
      fontFamily: 'Inter, sans-serif'
    },
    plotOptions: {
      bar: {
        borderRadius: 5,
        horizontal: true,
        barHeight: '65%',
        distributed: true
      }
    },
    colors: ['#38bdf8', '#6366f1', '#a855f7', '#f43f5e', '#f59e0b'],
    dataLabels: {
      enabled: true,
      textAnchor: 'start',
      style: { colors: ['#fff'], fontWeight: 600 },
      formatter: (val) => `${val}%`,
      offsetX: 8
    },
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.05)',
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: false } }
    },
    xaxis: {
      categories: ['Kids (0-12)', 'Teens (13-19)', 'Young Adults (20-35)', 'Mid-Age (36-55)', 'Seniors (56+)'],
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { show: false }
    },
    yaxis: {
      labels: {
        style: { fontSize: '0.8rem', fontWeight: 500 }
      }
    },
    legend: { show: false },
    tooltip: { theme: 'dark' },
    series: [{ data: [0, 0, 0, 0, 0] }]
  };

  ageChart = new ApexCharts(document.querySelector("#age-chart"), ageOptions);
  ageChart.render();

  // 4. Ethnicity Chart
  const ethnicityOptions = {
    chart: {
      type: 'bar',
      height: 240,
      background: 'transparent',
      toolbar: { show: false },
      foreColor: '#94a3b8',
      fontFamily: 'Inter, sans-serif'
    },
    plotOptions: {
      bar: {
        borderRadius: 5,
        columnWidth: '50%',
        distributed: false
      }
    },
    colors: ['#10b981'],
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'dark',
        type: "vertical",
        shadeIntensity: 0.5,
        gradientToColors: ['#06b6d4'],
        inverseColors: true,
        opacityFrom: 0.85,
        opacityTo: 0.85,
        stops: [0, 100]
      }
    },
    dataLabels: {
      enabled: true,
      formatter: (val) => `${val}%`,
      offsetY: -20,
      style: { fontSize: '0.8rem', colors: ['#94a3b8'] }
    },
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.05)',
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } }
    },
    xaxis: {
      categories: ['Chinese', 'Malay', 'Indian', 'Others'],
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: { formatter: (val) => `${val}%` }
    },
    tooltip: { theme: 'dark' },
    series: [{ name: 'Percentage', data: [0, 0, 0, 0] }]
  };

  ethnicityChart = new ApexCharts(document.querySelector("#ethnicity-chart"), ethnicityOptions);
  ethnicityChart.render();
}

// ==========================================
// DATA GENERATOR & SYNC RENDERER
// ==========================================

function formatSimTime() {
  const ampm = State.simHour >= 12 ? 'PM' : 'AM';
  const hour12 = State.simHour % 12 || 12;
  const minStr = String(State.simMinute).padStart(2, '0');
  const profileLabel = State.simProfile === 'weekday' ? 'Live video' : 'Sync Active';
  return `Simulated Time: ${hour12}:${minStr} ${ampm} (${profileLabel})`;
}

// Generates dynamic Hourly/Daily traffic curve driven by the video timeline
function generateTrafficChartSeries() {
  if (State.selectedTimeView === 'hourly') {
    const hourlyData = Array(24).fill(0);
    const categories = [];
    
    for (let h = 0; h < 24; h++) {
      categories.push(String(h).padStart(2, '0') + ':00');
    }

    // Determine current hour of the video
    const video = document.getElementById('entrance-video');
    const t = video ? video.currentTime : 0;
    const currentHour = Math.floor((t / videoDuration) * 24);

    // Count crossings whose first appearances fall inside each hour bin
    liveVideoPeople.forEach(p => {
      const enterTime = faceFirstAppearances.get(p.id) || 0;
      const h = Math.min(23, Math.floor((enterTime / videoDuration) * 24));
      if (h <= currentHour) {
        hourlyData[h]++;
      }
    });

    // Make future hours null so the chart plots progressively
    for (let h = currentHour + 1; h < 24; h++) {
      hourlyData[h] = null;
    }

    return {
      categories,
      series: [
        { name: 'Active Visitors', data: hourlyData }
      ]
    };
  } else {
    // Daily view: 7 days of the week mapping unique counts progressively
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const totalCount = liveVideoPeople.size;
    const data = [
      Math.round(totalCount * 0.4),
      Math.round(totalCount * 0.5),
      Math.round(totalCount * 0.7),
      Math.round(totalCount * 0.8),
      totalCount,
      null, // Future days in project
      null
    ];

    return {
      categories: days,
      series: [{ name: 'Daily Headcount', data: data }]
    };
  }
}

function updateDashboard() {
  const loc = State.selectedLocation;
  
  // Baselines start at exactly zero, incrementing purely on active video detections
  const baseCumulative = { all: 0, north_wing: 0, south_plaza: 0, food_court: 0, fashion_hub: 0 };
  const baseLive = { north_wing: 0, south_plaza: 0, food_court: 0, fashion_hub: 0 };

  if (videoStats.length > 0 && liveVideoPeople.size > 0) {
    const crossings = { all: 0, north_wing: 0, south_plaza: 0, food_court: 0, fashion_hub: 0 };
    liveVideoPeople.forEach(p => {
      crossings.all++;
      crossings[p.zone]++;
    });

    const activeFaces = { north_wing: 0, south_plaza: 0, food_court: 0, fashion_hub: 0 };
    const video = document.getElementById('entrance-video');
    if (video) {
      const currentFrameIdx = Math.min(videoStats.length, Math.max(1, Math.floor(video.currentTime * 12.0) + 1));
      const frameData = videoStats[currentFrameIdx - 1];
      if (frameData) {
        frameData.detections.forEach(det => {
          const zone = getAssignedZone(det.id, det.gender);
          activeFaces[zone]++;
        });
      }
    }

    // Update State variables dynamically
    Object.keys(State.cumulativeHeadcounts).forEach(k => {
      State.cumulativeHeadcounts[k] = baseCumulative[k] + crossings[k];
    });

    Object.keys(State.liveOccupancies).forEach(k => {
      // Map active faces directly to occupancy counts (multiplied slightly for visibility)
      State.liveOccupancies[k] = baseLive[k] + activeFaces[k] * 2;
    });
  } else {
    // Reset state to absolute zero
    Object.keys(State.cumulativeHeadcounts).forEach(k => State.cumulativeHeadcounts[k] = 0);
    Object.keys(State.liveOccupancies).forEach(k => State.liveOccupancies[k] = 0);
  }

  // Get active numbers for selected view
  let liveOccupancy = 0;
  if (loc === 'all') {
    liveOccupancy = Object.keys(State.liveOccupancies).reduce((acc, z) => acc + State.liveOccupancies[z], 0);
  } else {
    liveOccupancy = State.liveOccupancies[loc];
  }

  const cap = LocationMeta[loc].capacity;
  const occupancyPct = Math.min(100, Math.round((liveOccupancy / cap) * 100)) || 0;

  // Status badges
  let statusText = 'Normal';
  let statusClass = 'pulse';
  if (liveOccupancy === 0) {
    statusText = 'Inactive';
    statusClass = 'trend-down';
  } else if (occupancyPct > 80) {
    statusText = 'Peak Limit';
    statusClass = 'trend-down';
  } else if (occupancyPct > 45) {
    statusText = 'Moderate';
    statusClass = 'trend-up';
  }

  const statusBadge = document.getElementById('badge-occupancy-status');
  statusBadge.className = `kpi-badge ${statusClass}`;
  statusBadge.innerText = statusText;

  document.getElementById('val-cumulative').innerText = State.cumulativeHeadcounts[loc].toLocaleString();
  document.getElementById('val-occupancy').innerText = liveOccupancy.toLocaleString();
  
  // Average Dwell Time based on counted people's baseline averages
  const activePeople = Array.from(liveVideoPeople.values()).filter(p => loc === 'all' || p.zone === loc);
  let avgDwell = 0;
  if (activePeople.length > 0) {
    const sumDwell = activePeople.reduce((acc, p) => acc + LocationMeta[p.zone].dwellBase, 0);
    avgDwell = Math.round(sumDwell / activePeople.length);
  }
  document.getElementById('val-dwell').innerText = `${avgDwell}m`;

  // Determine Peak Traffic Hour from video crossing timeline
  const trendData = generateTrafficChartSeries();
  trafficChart.updateOptions({
    xaxis: { categories: trendData.categories }
  });
  trafficChart.updateSeries(trendData.series);

  // Peak hour calculation
  let peakHour = '-';
  let maxCrossings = 0;
  let peakHourIdx = -1;
  const video = document.getElementById('entrance-video');
  const t = video ? video.currentTime : 0;
  const currentHour = Math.floor((t / videoDuration) * 24);

  const hourlyData = trendData.series[0].data || [];
  for (let h = 0; h <= currentHour; h++) {
    if (hourlyData[h] > maxCrossings) {
      maxCrossings = hourlyData[h];
      peakHourIdx = h;
    }
  }

  if (peakHourIdx !== -1 && maxCrossings > 0) {
    const startStr = String(peakHourIdx).padStart(2, '0') + ':00';
    const endStr = String((peakHourIdx + 1) % 24).padStart(2, '0') + ':00';
    peakHour = `${startStr} - ${endStr}`;
    document.getElementById('val-peak').innerText = peakHour;
    document.getElementById('val-peak-volume').innerText = `${maxCrossings} pax/hr`;
  } else {
    document.getElementById('val-peak').innerText = '-';
    document.getElementById('val-peak-volume').innerText = '0 pax/hr';
  }

  // Update Demographic Charts purely from Live Detections
  if (videoStats.length > 0 && liveVideoPeople.size > 0) {
    const total = activePeople.length;
    
    if (total > 0) {
      let female = 0, male = 0, nonbinary = 0;
      let kids = 0, teens = 0, young = 0, mid = 0, seniors = 0;
      let chinese = 0, malay = 0, indian = 0, others = 0;

      activePeople.forEach(p => {
        // Only classify demographics if they are not 'Unknown'
        if (p.gender === 'Female') female++;
        else if (p.gender === 'Male') male++;
        else if (p.gender === 'Non-binary') nonbinary++;

        if (p.age && p.age !== 'Unknown') {
          if (p.age === '0-2' || p.age === '3-9') kids++;
          else if (p.age === '10-19') teens++;
          else if (p.age === '20-29' || p.age === '30-39') young++;
          else if (p.age === '40-49' || p.age === '50-59') mid++;
          else seniors++;
        }

        if (p.race && p.race !== 'Unknown') {
          const eth = getSingaporeEthnicity(p.id, p.race);
          if (eth === 'Chinese') chinese++;
          else if (eth === 'Malay') malay++;
          else if (eth === 'Indian') indian++;
          else others++;
        }
      });

      const genderTotal = male + female + nonbinary;
      if (genderTotal > 0) {
        sexChart.updateSeries([
          Math.round((male / genderTotal) * 100),
          Math.round((female / genderTotal) * 100),
          Math.round((nonbinary / genderTotal) * 100)
        ]);
      } else {
        sexChart.updateSeries([0, 0, 0]);
      }

      const ageTotal = kids + teens + young + mid + seniors;
      if (ageTotal > 0) {
        ageChart.updateSeries([{
          data: [
            Math.round((kids / ageTotal) * 100),
            Math.round((teens / ageTotal) * 100),
            Math.round((young / ageTotal) * 100),
            Math.round((mid / ageTotal) * 100),
            Math.round((seniors / ageTotal) * 100)
          ]
        }]);
      } else {
        ageChart.updateSeries([{ data: [0, 0, 0, 0, 0] }]);
      }

      const ethTotal = chinese + malay + indian + others;
      if (ethTotal > 0) {
        ethnicityChart.updateSeries([{
          data: [
            Math.round((chinese / ethTotal) * 100),
            Math.round((malay / ethTotal) * 100),
            Math.round((indian / ethTotal) * 100),
            Math.round((others / ethTotal) * 100)
          ]
        }]);
      } else {
        ethnicityChart.updateSeries([{ data: [0, 0, 0, 0] }]);
      }
    } else {
      // Show zero charts if no people assigned to this zone
      sexChart.updateSeries([0, 0, 0]);
      ageChart.updateSeries([{ data: [0, 0, 0, 0, 0] }]);
      ethnicityChart.updateSeries([{ data: [0, 0, 0, 0] }]);
    }
  } else {
    // Starting zero-state
    sexChart.updateSeries([0, 0, 0]);
    ageChart.updateSeries([{ data: [0, 0, 0, 0, 0] }]);
    ethnicityChart.updateSeries([{ data: [0, 0, 0, 0] }]);
  }

  renderZoneBreakdown();
}

function renderZoneBreakdown() {
  const zonesList = document.getElementById('zones-list');
  const isMultiSite = State.selectedLocation === 'all';
  const badgeElement = document.getElementById('multi-site-indicator');

  if (isMultiSite) {
    badgeElement.innerText = "Multi-Zone";
    badgeElement.className = "card-badge";
    
    let html = '';
    const zoneKeys = ['north_wing', 'south_plaza', 'food_court', 'fashion_hub'];
    
    zoneKeys.forEach(zk => {
      const active = State.liveOccupancies[zk];
      const cap = LocationMeta[zk].capacity;
      const pct = Math.min(100, Math.round((active / cap) * 100)) || 0;
      const isActiveClass = State.selectedLocation === zk ? 'active' : '';

      let fillCol = 'var(--color-indigo)';
      if (pct > 80) fillCol = 'var(--color-coral)';
      else if (pct > 60) fillCol = 'var(--color-amber)';
      else if (pct > 30) fillCol = 'var(--color-cyan)';
      else fillCol = 'var(--color-emerald)';

      html += `
        <div class="location-item ${isActiveClass}" data-zone="${zk}">
          <div class="location-meta">
            <span class="location-name">${LocationMeta[zk].name.split(' (')[0]}</span>
            <div class="location-metrics">
              <span class="location-pax">${active} pax</span>
              <span class="location-density-pct">${pct}% cap</span>
            </div>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${pct}%; background-color: ${fillCol}"></div>
          </div>
        </div>
      `;
    });
    zonesList.innerHTML = html;

    document.querySelectorAll('.location-item').forEach(item => {
      item.addEventListener('click', () => {
        const targetZone = item.getAttribute('data-zone');
        document.getElementById('location-select').value = targetZone;
        State.selectedLocation = targetZone;
        updateDashboard();
      });
    });
  } else {
    badgeElement.innerText = "Zone Detail";
    badgeElement.className = "card-badge";
    
    const zk = State.selectedLocation;
    const active = State.liveOccupancies[zk];
    const cap = LocationMeta[zk].capacity;
    const pct = Math.min(100, Math.round((active / cap) * 100)) || 0;
    const crossingsTotal = Object.values(State.liveOccupancies).reduce((a,b)=>a+b, 0);
    const contribution = crossingsTotal > 0 ? Math.round((active / crossingsTotal) * 100) : 0;

    zonesList.innerHTML = `
      <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem;">
        <h3 style="font-size: 0.95rem; font-weight:600; color:var(--text-secondary);">Zone Focus Metrics</h3>
        
        <div style="background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04);">
          <div style="display:flex; justify-content:space-between; margin-bottom: 0.25rem; font-size:0.8rem;">
            <span>Zone Capacity Limit</span>
            <span style="font-weight:600; color:var(--text-primary);">${cap.toLocaleString()} pax</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
            <span>Current Density</span>
            <span style="font-weight:600; color:var(--color-cyan);">${pct}% occupied</span>
          </div>
        </div>

        <div style="background: rgba(255,255,255,0.02); padding: 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04);">
          <div style="display:flex; justify-content:space-between; margin-bottom: 0.25rem; font-size:0.8rem;">
            <span>Contribution to Mall Total</span>
            <span style="font-weight:600; color:var(--color-indigo);">${contribution}% of mall occupancy</span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:0.8rem;">
            <span>Zone Rank</span>
            <span style="font-weight:600; color:var(--color-emerald);">#${getZoneRank(zk)} of 4</span>
          </div>
        </div>

        <button class="btn btn-outline btn-sm" id="btn-back-to-all" style="width: 100%; justify-content:center;">
          ← Back to All Zones View
        </button>
      </div>
    `;

    document.getElementById('btn-back-to-all').addEventListener('click', () => {
      document.getElementById('location-select').value = 'all';
      State.selectedLocation = 'all';
      updateDashboard();
    });
  }
}

function getZoneRank(zoneKey) {
  const sorted = Object.entries(State.liveOccupancies)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);
  return sorted.indexOf(zoneKey) + 1;
}

// ==========================================
// SIMULATOR LOOP (DRIVEN BY VIDEO PLAYBACK)
// ==========================================

let simInterval = null;

function runSimulationTick() {
  const video = document.getElementById('entrance-video');
  if (!video) return;

  const t = video.currentTime;
  const progress = t / videoDuration; // Video is dynamic length
  
  // Map timeline to a simulated 24 hour clock
  State.simHour = Math.floor(progress * 24);
  State.simMinute = Math.floor((progress * 24 * 60) % 60);

  document.getElementById('simulator-time').innerText = formatSimTime();
}

function startSimulatorEngine() {
  if (simInterval) clearInterval(simInterval);
  // Query play status every 250ms to keep clocks synchronized
  simInterval = setInterval(runSimulationTick, 250);
}

// ==========================================
// IN-BROWSER FACE TELEMETRY SYNC
// ==========================================

function setupVideoAnalytics() {
  const video = document.getElementById('entrance-video');
  if (!video) return;

  let lastFrameIdx = -1;
  let uniqueCrossedCount = 0;

  video.addEventListener('timeupdate', () => {
    if (videoStats.length === 0) return;

    const t = video.currentTime;
    const fps = 12.0; // Video processed at 12fps
    const currentFrame = Math.min(videoStats.length, Math.max(1, Math.floor(t * fps) + 1));
    
    if (currentFrame === lastFrameIdx) return;
    
    // If seeked backwards or loop reset
    if (currentFrame < lastFrameIdx) {
      liveVideoPeople.clear();
      uniqueCrossedCount = 0;
    }
    lastFrameIdx = currentFrame;

    // Accumulate unique detections up to currentFrame
    liveVideoPeople.clear();
    for (let f = 0; f < currentFrame; f++) {
      const frameData = videoStats[f];
      if (frameData && frameData.detections) {
        frameData.detections.forEach(det => {
          if (!liveVideoPeople.has(det.id)) {
            liveVideoPeople.set(det.id, {
              id: det.id,
              gender: det.gender,
              age: det.age,
              race: det.race,
              zone: getAssignedZone(det.id, det.gender)
            });
          }
        });
      }
    }

    const currentFrameData = videoStats[currentFrame - 1];
    if (!currentFrameData) return;

    // Update HUD counters
    document.getElementById('video-active-faces').innerText = currentFrameData.active_faces;
    const uniqueCount = currentFrameData.unique_count;
    document.getElementById('video-unique-counts').innerText = uniqueCount;

    // Flash glow trigger on crossings
    if (uniqueCount > uniqueCrossedCount) {
      uniqueCrossedCount = uniqueCount;
      const card = document.getElementById('kpi-headcount');
      if (card) {
        card.style.borderColor = 'var(--color-indigo)';
        card.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.4)';
        setTimeout(() => {
          card.style.borderColor = 'var(--border-card)';
          card.style.boxShadow = 'none';
        }, 300);
      }
    }

    // Refresh dashboard values (KPI metrics, chart plots, and demographics override)
    updateDashboard();
  });

  // Seek loop resets
  video.addEventListener('seeked', () => {
    if (video.currentTime < 0.5) {
      liveVideoPeople.clear();
      uniqueCrossedCount = 0;
      lastFrameIdx = -1;
      updateDashboard();
    }
  });

  video.addEventListener('ended', () => {
    liveVideoPeople.clear();
    uniqueCrossedCount = 0;
    lastFrameIdx = -1;
    updateDashboard();
  });
}

async function loadVideoStats() {
  try {
    const res = await fetch('/entrance_data.json');
    videoStats = await res.json();
    if (videoStats.length > 0) {
      videoDuration = videoStats[videoStats.length - 1].timestamp || 61.0;
    }
    calculateFirstAppearances();
    console.log('Successfully loaded InspireFace video stats:', videoStats.length, 'Duration:', videoDuration);
  } catch (err) {
    console.error('Error loading video telemetry json:', err);
  }
}

// ==========================================
// INTERACTIVE COMPONENT LISTENERS
// ==========================================

function setupEventListeners() {
  document.getElementById('location-select').addEventListener('change', (e) => {
    State.selectedLocation = e.target.value;
    updateDashboard();
  });

  document.getElementById('btn-hourly').addEventListener('click', () => {
    document.getElementById('btn-hourly').classList.add('active');
    document.getElementById('btn-daily').classList.remove('active');
    State.selectedTimeView = 'hourly';
    updateDashboard();
  });

  document.getElementById('btn-daily').addEventListener('click', () => {
    document.getElementById('btn-daily').classList.add('active');
    document.getElementById('btn-hourly').classList.remove('active');
    State.selectedTimeView = 'daily';
    updateDashboard();
  });

  const drawer = document.getElementById('simulator-drawer');
  document.getElementById('toggle-simulator-btn').addEventListener('click', () => {
    drawer.classList.add('open');
  });
  document.getElementById('close-simulator-btn').addEventListener('click', () => {
    drawer.classList.remove('open');
  });

  // Simulator controls disabled in pure video telemetry mode, notify user
  document.getElementById('sim-speed').addEventListener('input', (e) => {
    // Do nothing: Video playtime controls simulated timeline
  });
}

// ==========================================
// APP START
// ==========================================

window.addEventListener('DOMContentLoaded', async () => {
  initCharts();
  setupEventListeners();
  await loadVideoStats();
  setupVideoAnalytics();

  document.getElementById('simulator-time').innerText = formatSimTime();
  updateDashboard();
  startSimulatorEngine();
});
