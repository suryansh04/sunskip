import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { addPortalLayers } from "../map";

const MAX_PITCH = 70;

// The portal's one map. It hands the MapLibre map to its owner once the layers are added;
// pages then show their layers and fill them (map.ts). `interactive: false` is the still sign-in map.
export default function MapView({ center, zoom, onReady, interactive = true }) {
  const box = useRef(null);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current,
      style: import.meta.env.VITE_MAP_STYLE_URL,
      center,
      zoom,
      minZoom: 9,
      maxPitch: MAX_PITCH,
      interactive,
      attributionControl: false,
      fadeDuration: 0,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: !interactive }), interactive ? "bottom-right" : "top-right");
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(box.current);
    map.on("load", () => {
      addPortalLayers(map);
      onReady(map);
    });
    return () => {
      resize.disconnect();
      map.remove();
    };
  }, []);

  // MapLibre makes its box position: relative, so the box fills a wrapper that is absolute
  return (
    <div className="absolute inset-0">
      <div ref={box} className="h-full w-full" />
    </div>
  );
}
