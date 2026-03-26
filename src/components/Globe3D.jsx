import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// High-res realistic earth assets
const EARTH_BLUE_MARBLE = '//unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const EARTH_NIGHT       = '//unpkg.com/three-globe/example/img/earth-night.jpg';
const EARTH_WATER       = '//unpkg.com/three-globe/example/img/earth-water.png';
const EARTH_CLOUDS      = '//unpkg.com/three-globe/example/img/earth-clouds10k.png';
const NIGHT_SKY         = '//unpkg.com/three-globe/example/img/night-sky.png';

// ----- 3D Model Config -----
const SATELLITE_MODELS = {
  'ISS (ZARYA)': {
    url: 'https://raw.githubusercontent.com/niceBhaworworworworworworworwor/NASAModels/main/ISS.glb',
    scale: 0.015,
    nameMatch: 'ISS',
  },
};

// Fallback: we'll use custom Three.js geometry for iconic satellites
const ICONIC_SATELLITES = {
  'ISS': { color: '#FFD700', scale: 2.5, shape: 'station' },
  'HUBBLE': { color: '#C084FC', scale: 2.0, shape: 'telescope' },
  'TIANGONG': { color: '#EF4444', scale: 2.0, shape: 'station' },
  'CSS': { color: '#EF4444', scale: 2.0, shape: 'station' },
  'STARLINK': { color: '#00B4D8', scale: 1.2, shape: 'flatsat' },
  'GPS': { color: '#10B981', scale: 1.5, shape: 'navsatellite' },
  'NAVSTAR': { color: '#10B981', scale: 1.5, shape: 'navsatellite' },
  'GOES': { color: '#F97316', scale: 1.8, shape: 'weather' },
  'NOAA': { color: '#F59E0B', scale: 1.5, shape: 'weather' },
  'TERRA': { color: '#3B82F6', scale: 1.5, shape: 'science' },
  'AQUA': { color: '#06B6D4', scale: 1.5, shape: 'science' },
  'LANDSAT': { color: '#22C55E', scale: 1.5, shape: 'science' },
  'SENTINEL': { color: '#6366F1', scale: 1.5, shape: 'science' },
};

function getIconicConfig(name) {
  const upper = name.toUpperCase();
  for (const [key, config] of Object.entries(ICONIC_SATELLITES)) {
    if (upper.includes(key)) return config;
  }
  return null;
}

function visualAlt(altKm) {
  return Math.log(1 + altKm / 200) * 0.08;
}

export default function Globe3D({
  satellites,
  selectedSatellite,
  onSatelliteClick,
  onRecenter,
  // New feature props
  terminatorData,
  debrisData,
  footprintData,
  constellationData,
  islLinksData,
  launchData,
  heatmapData,
  features,
}) {
  const globeEl = useRef();
  const recenterRef = useRef(null);
  const [clouds, setClouds] = useState(null);
  const terminatorMeshRef = useRef(null);
  const sunLightRef = useRef(null);

  // Initial setup & Clouds
  useEffect(() => {
    const globe = globeEl.current;
    if (!globe) return;

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 120;
    controls.maxDistance = 600;

    globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 });

    // Add Clouds layer
    const CLOUDS_ALT = 0.004;
    const CLOUDS_ROTATION_SPEED = -0.006;

    new THREE.TextureLoader().load(EARTH_CLOUDS, cloudsTexture => {
      const cloudsObj = new THREE.Mesh(
        new THREE.SphereGeometry(globe.getGlobeRadius() * (1 + CLOUDS_ALT), 72, 72),
        new THREE.MeshPhongMaterial({ map: cloudsTexture, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      setClouds(cloudsObj);
      globe.scene().add(cloudsObj);

      (function rotateClouds() {
        cloudsObj.rotation.y += CLOUDS_ROTATION_SPEED * Math.PI / 180;
        requestAnimationFrame(rotateClouds);
      })();
    });
  }, []);

  // Fly to selected satellite
  useEffect(() => {
    if (!selectedSatellite || !globeEl.current) return;
    const controls = globeEl.current.controls();
    controls.autoRotate = false;
    globeEl.current.pointOfView(
      { lat: selectedSatellite.lat, lng: selectedSatellite.lng, altitude: 0.8 },
      1200
    );
  }, [selectedSatellite?.id]);

  // Expose recenter
  useEffect(() => {
    recenterRef.current = () => {
      if (!globeEl.current) return;
      if (selectedSatellite) {
        globeEl.current.pointOfView(
          { lat: selectedSatellite.lat, lng: selectedSatellite.lng, altitude: 0.8 },
          800
        );
      } else {
        const controls = globeEl.current.controls();
        controls.autoRotate = true;
        globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 1000);
      }
    };
  }, [selectedSatellite]);

  useEffect(() => {
    if (onRecenter) onRecenter.current = () => recenterRef.current?.();
  }, [onRecenter]);

  // Orbit path for selected satellite
  const pathsData = useMemo(() => {
    if (!selectedSatellite?.orbitPath?.length) return [];
    return [{ coords: selectedSatellite.orbitPath }];
  }, [selectedSatellite?.orbitPath]);

  // --- SOLAR TERMINATOR: Custom Three.js mesh ---
  useEffect(() => {
    const globe = globeEl.current;
    if (!globe) return;
    const scene = globe.scene();

    // Remove old terminator mesh
    if (terminatorMeshRef.current) {
      scene.remove(terminatorMeshRef.current);
      terminatorMeshRef.current.geometry?.dispose();
      terminatorMeshRef.current.material?.dispose();
      terminatorMeshRef.current = null;
    }

    if (!features?.terminator || !terminatorData?.coords?.length) return;

    const R = globe.getGlobeRadius() * 1.002;
    const coords = terminatorData.coords;
    const sunPos = terminatorData.sunPos;

    // Create a dark hemisphere mesh for night side
    // We create a ring of vertices along the terminator + south/north pole
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];

    // Center point (anti-solar point)
    const antiSolarLat = -sunPos.lat * Math.PI / 180;
    const antiSolarLng = ((sunPos.lng + 180) % 360 - 180) * Math.PI / 180;
    const cx = R * Math.cos(antiSolarLat) * Math.cos(antiSolarLng);
    const cy = R * Math.sin(antiSolarLat);
    const cz = R * Math.cos(antiSolarLat) * Math.sin(-antiSolarLng);
    vertices.push(cx, cy, cz);

    // Terminator ring vertices
    for (const [lat, lng] of coords) {
      const latR = lat * Math.PI / 180;
      const lngR = lng * Math.PI / 180;
      const x = R * Math.cos(latR) * Math.cos(lngR);
      const y = R * Math.sin(latR);
      const z = R * Math.cos(latR) * Math.sin(-lngR);
      vertices.push(x, y, z);
    }

    // Triangulate: fan from center to terminator ring
    const n = coords.length;
    for (let i = 1; i < n; i++) {
      indices.push(0, i, i + 1);
    }
    indices.push(0, n, 1); // close the ring

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: 0x000022,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    terminatorMeshRef.current = mesh;

    return () => {
      if (terminatorMeshRef.current) {
        scene.remove(terminatorMeshRef.current);
        terminatorMeshRef.current.geometry?.dispose();
        terminatorMeshRef.current.material?.dispose();
        terminatorMeshRef.current = null;
      }
    };
  }, [features?.terminator, terminatorData]);

  // --- FOOTPRINT: polygon on globe ---
  const footprintPolygons = useMemo(() => {
    if (!features?.footprint || !footprintData?.length || !selectedSatellite) return [];
    return [{
      coords: footprintData,
      color: 'rgba(0, 240, 255, 0.12)',
      strokeColor: 'rgba(0, 240, 255, 0.6)',
    }];
  }, [features?.footprint, footprintData, selectedSatellite]);

  // --- DEBRIS: render as custom layer points ---
  const debrisPoints = useMemo(() => {
    if (!features?.debris || !debrisData?.length) return [];
    return debrisData;
  }, [features?.debris, debrisData]);

  // --- HEATMAP: rendered as custom layer ---
  const heatmapPoints = useMemo(() => {
    if (!features?.heatmap || !heatmapData?.length) return [];
    return heatmapData;
  }, [features?.heatmap, heatmapData]);

  // --- ISL LINKS: arcs between satellites ---
  const arcData = useMemo(() => {
    if (!features?.islLinks || !islLinksData?.length) return [];
    return islLinksData.map((link, i) => ({
      id: `isl-${i}`,
      startLat: link.startLat,
      startLng: link.startLng,
      endLat: link.endLat,
      endLng: link.endLng,
      color: link.color || '#00F0FF',
      altStart: link.startAlt,
      altEnd: link.endAlt,
    }));
  }, [features?.islLinks, islLinksData]);

  // --- LAUNCH PADS: markers on globe ---
  const launchPadPoints = useMemo(() => {
    if (!features?.launches) return [];
    const pads = [];
    const allLaunches = [
      ...(launchData?.upcoming || []),
      ...(launchData?.recent || []),
    ];
    const seen = new Set();
    for (const l of allLaunches) {
      if (l.padLat != null && l.padLng != null) {
        const key = `${l.padLat.toFixed(2)},${l.padLng.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pads.push({
          lat: l.padLat,
          lng: l.padLng,
          name: l.padName,
          location: l.padLocation,
          size: 1.2,
          color: '#F97316',
        });
      }
    }
    return pads;
  }, [features?.launches, launchData]);

  // --- CONSTELLATION RINGS: custom objects for orbital planes ---
  useEffect(() => {
    const globe = globeEl.current;
    if (!globe || !features?.constellations) return;

    const scene = globe.scene();
    const R = globe.getGlobeRadius();
    const rings = [];

    if (constellationData?.groups) {
      for (const [, group] of constellationData.groups) {
        if (group.satellites.length < 3) continue;

        // Calculate average altitude and inclination for this group
        let totalAlt = 0, totalInc = 0;
        for (const sat of group.satellites) {
          totalAlt += sat.alt || 400;
          totalInc += sat.inclination || 0;
        }
        const avgAlt = totalAlt / group.satellites.length;
        const avgInc = totalInc / group.satellites.length;
        const ringRadius = R * (1 + visualAlt(avgAlt));

        // Create ring geometry for the orbital plane
        const ringGeo = new THREE.RingGeometry(ringRadius - 0.3, ringRadius + 0.3, 128);
        const ringMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(group.info.color),
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = (90 - avgInc) * Math.PI / 180;
        ring.userData.isConstellationRing = true;

        scene.add(ring);
        rings.push(ring);
      }
    }

    return () => {
      for (const ring of rings) {
        scene.remove(ring);
        ring.geometry?.dispose();
        ring.material?.dispose();
      }
    };
  }, [features?.constellations, constellationData]);

  // HTML Element for satellites (Widget/Icon with 3D model support)
  const renderSatelliteWidget = useCallback((d) => {
    const el = document.createElement('div');
    const isSelected = selectedSatellite && d.id === selectedSatellite.id;
    const iconicConfig = getIconicConfig(d.name);

    el.className = `sat-widget ${isSelected ? 'selected' : ''} cat-${d.category}${iconicConfig ? ' iconic' : ''}`;

    if (iconicConfig) {
      // Render iconic satellite with custom 3D-style widget
      const model3d = document.createElement('div');
      model3d.className = `sat-model-3d shape-${iconicConfig.shape}`;
      model3d.style.setProperty('--model-color', iconicConfig.color);
      model3d.style.setProperty('--model-scale', iconicConfig.scale);
      el.appendChild(model3d);

      // Glow ring for iconic sats
      const glow = document.createElement('div');
      glow.className = 'sat-model-glow';
      glow.style.setProperty('--model-color', iconicConfig.color);
      el.appendChild(glow);
    } else {
      // Default core dot
      const core = document.createElement('div');
      core.className = 'sat-core';
      el.appendChild(core);
    }

    // Label
    const label = document.createElement('div');
    label.className = 'sat-label';
    label.textContent = d.name;
    el.appendChild(label);

    // Pulsing ring for selected
    if (isSelected) {
      const ring = document.createElement('div');
      ring.className = 'sat-ring';
      el.appendChild(ring);
    }

    el.onclick = () => {
      if (onSatelliteClick) onSatelliteClick(d);
    };

    return el;
  }, [selectedSatellite?.id, onSatelliteClick]);

  // Debris widget renderer
  const renderDebrisWidget = useCallback((d) => {
    const el = document.createElement('div');
    el.className = 'debris-dot';
    el.title = d.name;
    return el;
  }, []);

  // Heatmap widget renderer
  const renderHeatmapWidget = useCallback((d) => {
    const el = document.createElement('div');
    el.className = 'heatmap-point';
    const intensity = Math.round(d.weight * 255);
    el.style.setProperty('--heat-r', Math.min(255, intensity * 2));
    el.style.setProperty('--heat-g', Math.max(0, 255 - intensity * 2));
    el.style.setProperty('--heat-size', `${8 + d.weight * 30}px`);
    el.style.setProperty('--heat-opacity', 0.15 + d.weight * 0.5);
    el.title = `${d.count} satellites`;
    return el;
  }, []);

  // Launch pad widget renderer
  const renderLaunchPad = useCallback((d) => {
    const el = document.createElement('div');
    el.className = 'launch-pad-marker';
    
    const icon = document.createElement('div');
    icon.className = 'launch-pad-icon';
    icon.textContent = '🚀';
    el.appendChild(icon);

    const label = document.createElement('div');
    label.className = 'launch-pad-label';
    label.textContent = d.name;
    el.appendChild(label);

    return el;
  }, []);

  // Combine all HTML elements data
  const allHtmlData = useMemo(() => {
    const data = [...satellites.map(s => ({ ...s, _type: 'satellite' }))];

    if (features?.debris && debrisPoints.length > 0) {
      data.push(...debrisPoints.map(d => ({ ...d, _type: 'debris' })));
    }

    if (features?.heatmap && heatmapPoints.length > 0) {
      data.push(...heatmapPoints.map(h => ({ ...h, _type: 'heatmap', alt: h.avgAlt || 0 })));
    }

    if (features?.launches && launchPadPoints.length > 0) {
      data.push(...launchPadPoints.map(l => ({ ...l, _type: 'launchpad', alt: 0 })));
    }

    return data;
  }, [satellites, features, debrisPoints, heatmapPoints, launchPadPoints]);

  const renderHtmlElement = useCallback((d) => {
    if (d._type === 'debris') return renderDebrisWidget(d);
    if (d._type === 'heatmap') return renderHeatmapWidget(d);
    if (d._type === 'launchpad') return renderLaunchPad(d);
    return renderSatelliteWidget(d);
  }, [renderSatelliteWidget, renderDebrisWidget, renderHeatmapWidget, renderLaunchPad]);

  return (
    <div className="globe-container">
      <Globe
        ref={globeEl}
        globeImageUrl={EARTH_BLUE_MARBLE}
        bumpImageUrl={EARTH_WATER}
        backgroundImageUrl={NIGHT_SKY}
        showAtmosphere={true}
        atmosphereColor="#00E5FF"
        atmosphereAltitude={0.25}
        animateIn={true}

        // HTML Widgets for satellites, debris, heatmap, launch pads
        htmlElementsData={allHtmlData}
        htmlElement={renderHtmlElement}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={d => {
          if (d._type === 'debris') return visualAlt(d.alt || 400);
          if (d._type === 'heatmap') return 0.01;
          if (d._type === 'launchpad') return 0.01;
          return visualAlt(d.alt);
        }}

        // Custom globe material for Day/Night specular
        onGlobeReady={() => {
          const globeMaterial = globeEl.current.globeMaterial();
          globeMaterial.bumpScale = 15;
          new THREE.TextureLoader().load(EARTH_WATER, texture => {
            globeMaterial.specularMap = texture;
            globeMaterial.specular = new THREE.Color('#333333');
            globeMaterial.shininess = 25;
          });

          const scene = globeEl.current.scene();
          const dLight = scene.children.find(obj => obj.type === 'DirectionalLight');
          if (dLight) {
            dLight.intensity = 2.0;
            dLight.position.set(1, 0.5, 1).normalize();
            sunLightRef.current = dLight;
          }
          const aLight = scene.children.find(obj => obj.type === 'AmbientLight');
          if (aLight) {
            aLight.intensity = 0.15;
          }
        }}

        // Maps / Labels
        tilesData={[{
          lat: 0, lng: 0,
          url: 'https://{s}.basemaps.cartocdn.com/rastertiles/light_only_labels/{z}/{x}/{y}.png'
        }]}
        tileLat="lat"
        tileLng="lng"
        tileAltitude={() => 0.005}
        tileUrl="url"

        // Orbit path
        pathsData={pathsData}
        pathPoints="coords"
        pathPointLat={p => p[0]}
        pathPointLng={p => p[1]}
        pathPointAlt={p => visualAlt(p[2])}
        pathColor={() => 'rgba(255, 255, 255, 0.4)'}
        pathStroke={1.5}
        pathDashLength={0.02}
        pathDashGap={0.01}
        pathDashAnimateTime={60000}

        // Footprint polygon
        polygonsData={footprintPolygons}
        polygonCapColor={d => d.color}
        polygonSideColor={() => 'rgba(0, 240, 255, 0.05)'}
        polygonStrokeColor={d => d.strokeColor}
        polygonAltitude={0.002}
        polygonGeoJsonGeometry={d => ({
          type: 'Polygon',
          coordinates: [d.coords.map(([lat, lng]) => [lng, lat])],
        })}

        // ISL Links as arcs
        arcsData={arcData}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={d => d.color}
        arcAltitude={0.15}
        arcStroke={0.4}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={2000}
      />

      {/* Terminator legend */}
      {features?.terminator && terminatorData?.sunPos && (
        <div className="terminator-legend">
          <div className="terminator-legend-item">
            <span className="terminator-sun-icon">☀</span>
            <span className="terminator-legend-text">
              Subsolar: {terminatorData.sunPos.lat.toFixed(1)}°, {terminatorData.sunPos.lng.toFixed(1)}°
            </span>
          </div>
        </div>
      )}

      {/* Debris counter */}
      {features?.debris && debrisPoints.length > 0 && (
        <div className="debris-counter">
          <span className="debris-counter-icon">⚠</span>
          <span className="debris-counter-text">{debrisPoints.length} DEBRIS OBJECTS</span>
        </div>
      )}

      {/* Constellation legend */}
      {features?.constellations && constellationData?.groups?.size > 0 && (
        <div className="constellation-legend">
          {[...constellationData.groups.entries()].map(([name, group]) => (
            <div key={name} className="constellation-legend-item">
              <span
                className="constellation-color-dot"
                style={{ background: group.info.color }}
              />
              <span>{name}</span>
              <span className="constellation-count mono">{group.satellites.length}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
