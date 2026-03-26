import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchDebris } from '../services/debrisService';
import { fetchUpcomingLaunches, fetchRecentLaunches } from '../services/launchService';
import { getSunPosition, getTerminatorCoords } from '../services/sunPosition';
import { getFootprintPolygon } from '../services/visibilityService';
import { groupByConstellation, computeISLLinks } from '../services/constellationService';
import { generateHeatmapData } from '../services/heatmapService';

/**
 * Hook that manages all enhanced feature state and data.
 */
export function useFeatures(satellites, selectedSatellite) {
  // Feature toggle states
  const [features, setFeatures] = useState({
    terminator: false,
    debris: false,
    footprint: true, // on by default when a satellite is selected
    constellations: false,
    islLinks: false,
    launches: false,
    heatmap: false,
  });

  // Data states
  const [debrisData, setDebrisData] = useState([]);
  const [debrisLoading, setDebrisLoading] = useState(false);
  const [launchData, setLaunchData] = useState({ upcoming: [], recent: [] });
  const [launchLoading, setLaunchLoading] = useState(false);

  // Toggle a feature
  const toggleFeature = useCallback((key) => {
    setFeatures(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // --- Solar Terminator ---
  const terminatorData = useMemo(() => {
    if (!features.terminator) return { coords: [], sunPos: null };
    const sunPos = getSunPosition();
    const coords = getTerminatorCoords();
    return { coords, sunPos };
  }, [features.terminator, satellites]); // re-calc when satellites update (every 2s)

  // --- Debris ---
  useEffect(() => {
    if (features.debris && debrisData.length === 0 && !debrisLoading) {
      setDebrisLoading(true);
      fetchDebris(150).then(data => {
        setDebrisData(data);
        setDebrisLoading(false);
      }).catch(() => setDebrisLoading(false));
    }
  }, [features.debris, debrisData.length, debrisLoading]);

  // --- Visibility Footprint ---
  const footprintData = useMemo(() => {
    if (!features.footprint || !selectedSatellite) return [];
    return getFootprintPolygon(
      selectedSatellite.lat,
      selectedSatellite.lng,
      selectedSatellite.alt
    );
  }, [features.footprint, selectedSatellite?.lat, selectedSatellite?.lng, selectedSatellite?.alt]);

  // --- Constellation Grouping ---
  const constellationData = useMemo(() => {
    if (!features.constellations) return { groups: new Map(), planes: [] };
    const groups = groupByConstellation(satellites);
    return { groups };
  }, [features.constellations, satellites]);

  // --- ISL Links ---
  const islLinksData = useMemo(() => {
    if (!features.islLinks) return [];
    // Find the constellation of the selected satellite, or use GPS as default
    const groups = groupByConstellation(satellites);
    const allLinks = [];

    for (const [, group] of groups) {
      if (group.satellites.length < 3) continue;
      // Limit links computation to constellations with reasonable size
      const sats = group.satellites.slice(0, 50); // cap for performance
      const links = computeISLLinks(sats, group.info.maxLinkDist, 2);
      links.forEach(l => { l.color = group.info.color; });
      allLinks.push(...links);
    }

    return allLinks;
  }, [features.islLinks, satellites]);

  // --- Live Launches ---
  useEffect(() => {
    if (features.launches && launchData.upcoming.length === 0 && !launchLoading) {
      setLaunchLoading(true);
      Promise.all([
        fetchUpcomingLaunches(8),
        fetchRecentLaunches(3),
      ]).then(([upcoming, recent]) => {
        setLaunchData({ upcoming, recent });
        setLaunchLoading(false);
      }).catch(() => setLaunchLoading(false));
    }
  }, [features.launches, launchData.upcoming.length, launchLoading]);

  // --- Heatmap ---
  const heatmapData = useMemo(() => {
    if (!features.heatmap) return [];
    return generateHeatmapData(satellites, 8);
  }, [features.heatmap, satellites]);

  return {
    features,
    toggleFeature,
    terminatorData,
    debrisData: features.debris ? debrisData : [],
    debrisLoading,
    footprintData,
    constellationData,
    islLinksData,
    launchData: features.launches ? launchData : { upcoming: [], recent: [] },
    launchLoading,
    heatmapData,
  };
}
