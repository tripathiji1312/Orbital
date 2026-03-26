import { useRef, useState, useCallback } from 'react';
import { useSatellites } from './hooks/useSatellites';
import { useFeatures } from './hooks/useFeatures';
import LoadingScreen from './components/LoadingScreen';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import Globe3D from './components/Globe3D';
import SatelliteDetail from './components/SatelliteDetail';
import BottomBar from './components/BottomBar';
import FeatureToggles from './components/FeatureToggles';
import LaunchPanel from './components/LaunchPanel';

export default function App() {
  const {
    satellites,
    totalCount,
    selectedSatellite,
    selectSatellite,
    searchQuery,
    setSearchQuery,
    activeCategory,
    setActiveCategory,
    loading,
    error,
    categories,
  } = useSatellites();

  const {
    features,
    toggleFeature,
    terminatorData,
    debrisData,
    debrisLoading,
    footprintData,
    constellationData,
    islLinksData,
    launchData,
    launchLoading,
    heatmapData,
  } = useFeatures(satellites, selectedSatellite);

  const recenterRef = useRef(null);
  const [showLaunchPanel, setShowLaunchPanel] = useState(false);

  const handleRecenter = () => {
    recenterRef.current?.();
  };

  const handleTrack = () => {
    recenterRef.current?.();
  };

  // Toggle launches also toggles the panel
  const handleToggleFeature = useCallback((key) => {
    toggleFeature(key);
    if (key === 'launches') {
      setShowLaunchPanel(prev => !prev);
    }
  }, [toggleFeature]);

  const handleFlyTo = useCallback((lat, lng) => {
    if (!recenterRef.current) return;
    // We'll use the globe ref through recenter mechanism
  }, []);

  return (
    <>
      <LoadingScreen loading={loading} />

      <div className={`app${selectedSatellite ? ' has-detail' : ''}`}>
        <TopBar
          satelliteCount={totalCount}
          isConnected={!error && !loading}
          debrisCount={features.debris ? debrisData.length : 0}
        />

        <Sidebar
          satellites={satellites}
          categories={categories}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedSatellite={selectedSatellite}
          onSelectSatellite={selectSatellite}
          totalCount={totalCount}
        />

        <Globe3D
          satellites={satellites}
          selectedSatellite={selectedSatellite}
          onSatelliteClick={selectSatellite}
          onRecenter={recenterRef}
          terminatorData={terminatorData}
          debrisData={debrisData}
          footprintData={footprintData}
          constellationData={constellationData}
          islLinksData={islLinksData}
          launchData={launchData}
          heatmapData={heatmapData}
          features={features}
        />

        <FeatureToggles
          features={features}
          onToggle={handleToggleFeature}
          debrisLoading={debrisLoading}
          launchLoading={launchLoading}
        />

        {selectedSatellite && (
          <SatelliteDetail
            satellite={selectedSatellite}
            onClose={() => selectSatellite(null)}
            onTrack={handleTrack}
          />
        )}

        {showLaunchPanel && features.launches && (
          <LaunchPanel
            launchData={launchData}
            loading={launchLoading}
            onClose={() => setShowLaunchPanel(false)}
            onFlyTo={handleFlyTo}
          />
        )}

        <BottomBar
          selectedSatellite={selectedSatellite}
          onRecenter={handleRecenter}
        />
      </div>
    </>
  );
}
