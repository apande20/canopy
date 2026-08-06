/*
  CANOPY SCORING ENGINE — v0.1 (prototype)
  ------------------------------------------
  This file replaces the fake random-number demo with real data calls.
  Read the comments — they explain what each piece does, since you're
  learning as we go.

  WHAT THIS FILE DOES RIGHT NOW:
  1. Takes an address typed by the user (e.g. "Yolo County, CA")
  2. Converts it into coordinates (latitude/longitude) — this is called
     "geocoding" — using a free, no-signup service called Nominatim
     (it's the API behind OpenStreetMap).
  3. Uses those coordinates to ask FEMA's real flood map database
     what flood zone that exact spot is in.
  4. Turns the flood zone into a 0-100 score (this is one real
     ingredient of your "Housing Feasibility" lens).

  WHAT'S STILL FAKE / NOT BUILT YET (so you know exactly where we are):
  - Farmland lens: still 100% placeholder
  - Freshwater lens: still 100% placeholder
  - Housing lens: only the flood-risk portion is real; zoning,
    soil bearing capacity, utility access, and comps are still fake
  - No caching, no error retry logic, no loading states in the UI yet

  NEXT STEPS (Week 1-2, in order):
  - Wire this into index.html's "Generate memo" button
  - Add a real soil data source for the Farmland lens
  - Add a real groundwater/well data source for the Freshwater lens
  - Add real zoning data for the rest of Housing
*/

// ---------------------------------------------------------------
// STEP 1: Turn a typed address into coordinates
// ---------------------------------------------------------------
async function geocodeAddress(address) {
  // Nominatim is free and doesn't require an API key, but it DOES
  // require us to identify our app via a custom header/param, and
  // it asks that we don't hammer it with requests (max ~1/sec).
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;

  const response = await fetch(url, {
    headers: {
      // Nominatim's usage policy asks for a way to identify the app.
      // Replace this with your actual project name/contact before launch.
      'Accept-Language': 'en-US'
    }
  });

  if (!response.ok) {
    throw new Error('Geocoding request failed: ' + response.status);
  }

  const results = await response.json();

  if (!results || results.length === 0) {
    throw new Error('Could not find that location. Try a more specific address.');
  }

  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
    displayName: results[0].display_name
  };
}

// ---------------------------------------------------------------
// STEP 2: Look up the real FEMA flood zone for those coordinates
// ---------------------------------------------------------------
async function getFloodZone(lat, lon) {
  // This queries FEMA's public National Flood Hazard Layer (NFHL)
  // map service directly — it's a government GIS server that allows
  // "identify" queries: "what flood zone is at this exact point?"
  const baseUrl = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';

  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY',
    returnGeometry: 'false',
    f: 'json'
  });

  const response = await fetch(`${baseUrl}?${params.toString()}`);

  if (!response.ok) {
    throw new Error('Flood zone lookup failed: ' + response.status);
  }

  const data = await response.json();

  if (!data.features || data.features.length === 0) {
    // No flood zone data at this point usually means "Zone X" —
    // i.e. minimal flood risk, or simply un-mapped rural area.
    return { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', unmapped: true };
  }

  const attrs = data.features[0].attributes;
  return {
    zone: attrs.FLD_ZONE,
    subtype: attrs.ZONE_SUBTY,
    unmapped: false
  };
}

// ---------------------------------------------------------------
// STEP 3: Turn the flood zone into a 0-100 sub-score
// ---------------------------------------------------------------
function scoreFloodRisk(floodZone) {
  // These weights are a starting point — this is exactly the kind
  // of judgment call that should reflect YOUR underwriting logic,
  // not mine. We should revisit these numbers together.
  const zoneScores = {
    'X': 95,      // minimal risk
    'D': 70,      // undetermined risk
    'AE': 45,     // 1% annual chance flood, w/ base flood elevations
    'A': 40,      // 1% annual chance flood
    'AH': 42,
    'AO': 42,
    'VE': 20,     // coastal high hazard
    'V': 22
  };

  return zoneScores[floodZone.zone] !== undefined ? zoneScores[floodZone.zone] : 50;
}

// ---------------------------------------------------------------
// PUTTING IT TOGETHER: what the UI will call
// ---------------------------------------------------------------
async function runRealScan(addressText) {
  const location = await geocodeAddress(addressText);
  const flood = await getFloodZone(location.lat, location.lon);
  const floodScore = scoreFloodRisk(flood);

  return {
    location,
    flood,
    housingFeasibility: {
      floodComponent: floodScore,
      // Placeholder until zoning + soil bearing + utility access are added:
      note: 'Partial score — flood risk only. Zoning, soil, and utility data not yet integrated.'
    }
  };
}

// Export for use in index.html or a test page
if (typeof module !== 'undefined') {
  module.exports = { geocodeAddress, getFloodZone, scoreFloodRisk, runRealScan };
}
