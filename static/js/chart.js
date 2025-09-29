let countryFeat = [];
let continentFeat = [];

async function loadCountryPolygons() {
  try {
    const res = await fetch("js/countries.geojson");
    const data = await res.json();
    countryFeat = data.features;
    console.log("Loaded", countryFeat.length, "country polygons");
  } catch (err) {
    console.error("Failed to load countries.geojson", err);
  }
}

async function loadContinentPolygons() {
  try {
    const res = await fetch("js/continents.geojson");
    const data = await res.json();
    continentFeat = data.features;
    console.log("Loaded", continentFeat.length, "continent polygons");
  } catch (err) {
    console.error("Failed to load continent GeoJSON", err);
  }
}

function lookupCountry(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of countryFeat) {
    if (turf.booleanPointInPolygon(pt, feature)) {
      return feature.properties.name || "Unknown";
    }
  }
  return "Unknown";
}

function lookupContinent(lat, lon) {
  const pt = turf.point([lon, lat]);
  for (const feature of continentFeat) {
    if (turf.booleanPointInPolygon(pt, feature)) {
      return feature.properties.continent || "Unknown";
    }
  }
  return "Unknown";
}

async function fetchSpotCount() {
  try {
    const response = await fetch('/spots');
    const spots = await response.json();

    const now = new Date();
    const cutoff = new Date(now.getTime() - 15 * 60 * 1000);

    const recentSpots = spots.filter(spot => {
      const spotTime = new Date(spot.timestamp); // adjust if backend sends "time" instead
      return spotTime >= cutoff;
    });

    const grouped = {};
    for (const spot of recentSpots) {
      const lat = spot.lat;
      const lon = spot.lon;
      const country = lookupCountry(lat, lon);
      const continent = lookupContinent(lat, lon);
      const key = country + "|" + continent;
      if (!grouped[key]) {
        grouped[key] = { count: 0, country, continent };
      }
      grouped[key].count++;
    }

    const tbody = document.getElementById("spot-count");
    tbody.innerHTML = "";
    Object.values(grouped).forEach(row => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${row.count}</td>
        <td>${row.country}</td>
        <td>${row.continent}</td>
      `;
      tbody.appendChild(tr);
    });

    if (Object.keys(grouped).length === 0) {
      tbody.innerHTML = `<tr><td colspan="3">No spots in last 15 minutes</td></tr>`;
    }
  } catch (err) {
    console.error("Error fetching spot data:", err);
  }
}

(async function init() {
  await loadCountryPolygons();
  await loadContinentPolygons();
  fetchSpotCount();
  setInterval(fetchSpotCount, 30000);
})();
