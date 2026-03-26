/**
 * Space debris data service.
 * Fetches debris TLE data from CelesTrak and propagates positions.
 */
import { createSatRec, getPosition } from './propagator';

const DEBRIS_URLS = {
  'cosmos-2251': {
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=tle',
    label: 'Cosmos 2251 Debris',
  },
  'iridium-33': {
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=tle',
    label: 'Iridium 33 Debris',
  },
  'fengyun-1c': {
    url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=1999-025&FORMAT=tle',
    label: 'Fengyun-1C Debris',
  },
};

function parseTLE(tleText) {
  const lines = tleText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const sats = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (!lines[i + 1].startsWith('1') || !lines[i + 2].startsWith('2')) continue;
    sats.push({
      name: lines[i].replace(/^0\s+/, ''),
      tle1: lines[i + 1],
      tle2: lines[i + 2],
    });
  }
  return sats;
}

/**
 * Fetch debris TLEs and compute initial positions.
 * Returns array of { id, name, lat, lng, alt, source }.
 */
export async function fetchDebris(maxPerSource = 200) {
  const allDebris = [];

  const promises = Object.entries(DEBRIS_URLS).map(async ([key, config]) => {
    try {
      const resp = await fetch(config.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const tles = parseTLE(text).slice(0, maxPerSource);

      const items = [];
      for (const tle of tles) {
        try {
          const satrec = createSatRec(tle.tle1, tle.tle2);
          const pos = getPosition(satrec);
          if (!pos) continue;
          const noradId = parseInt(tle.tle1.substring(2, 7));
          items.push({
            id: `debris-${noradId}`,
            noradId,
            name: tle.name,
            source: key,
            sourceLabel: config.label,
            ...pos,
          });
        } catch { /* skip bad TLEs */ }
      }
      return items;
    } catch (err) {
      console.warn(`Failed to fetch debris ${key}:`, err);
      return [];
    }
  });

  const groups = await Promise.all(promises);
  groups.forEach(g => allDebris.push(...g));
  return allDebris;
}
