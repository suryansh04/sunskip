import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { areaByKey } from "../areas";
import TopBar from "../components/TopBar";
import MapView from "../components/MapView";

const TAB_PATHS = { pain: "/", recs: "/recommendations", sim: "/simulate", stats: "/stats" };
const START_ZOOM = 15;

function tabOf(location) {
  if (location.pathname.startsWith("/stretch/")) return location.state?.from || "pain";
  return Object.keys(TAB_PATHS).find((tab) => TAB_PATHS[tab] === location.pathname) || "pain";
}

// The signed-in portal: top bar, one map kept alive across tabs, and the tab's panel (Outlet).
// The stretch evidence page covers the map and the panel.
export default function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [map, setMap] = useState(null);
  const [areaKey, setAreaKey] = useState(() => localStorage.getItem("area") || "muj");
  const area = areaByKey(areaKey);
  const fullPage = location.pathname.startsWith("/stretch/");

  function pickArea(key) {
    localStorage.setItem("area", key);
    setAreaKey(key);
    if (fullPage) navigate("/");
  }

  return (
    <div className="grid h-full grid-rows-[56px_1fr] print:block">
      <TopBar tab={tabOf(location)} onTab={(tab) => navigate(TAB_PATHS[tab])} area={area} onArea={pickArea} />
      <main className="relative grid min-h-0 grid-cols-[1fr_560px] print:block">
        <div className={fullPage ? "hidden" : "relative min-w-0"}>
          <MapView center={area.center} zoom={START_ZOOM} onReady={setMap} />
        </div>
        <Outlet context={{ map, area }} />
      </main>
    </div>
  );
}
