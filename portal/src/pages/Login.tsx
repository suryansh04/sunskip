import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import { Cube, Fire, SignIn, Tree } from "@phosphor-icons/react";
import { DEMO, login } from "../auth";
import { midpoint, setSource, showLayers } from "../map";
import MapView from "../components/MapView";
import DemoAccount from "../components/DemoAccount";
import mujPain from "../api/fixtures/heat-pain.json";

const MAP_CENTER = [75.5632, 26.8424];
const MAP_ZOOM = 15.6;
const SHOWN = "str_15221"; // GHs Footpath, the stretch the caption talks about
const DOES = [
  { icon: Fire, title: "Heat pain.", text: "The paths with the most people in full sun." },
  { icon: Tree, title: "Trees and shelters.", text: "Ranked by sun-minutes saved per rupee." },
  { icon: Cube, title: "Simulator.", text: "Test a plan in 3D before spending." },
];

// The still map behind sign-in is a real capture of the heat pain near MUJ (it can't call the API before sign-in)
// The stretch the caption talks about is outlined in ink and tagged, so the caption points at one path
function drawPain(map) {
  showLayers(map, ["stretch-hi", "stretches"]);
  setSource(map, "stretches", mujPain.features.map((feature) => ({ type: "Feature", properties: { id: feature.properties.stretchId, pain: feature.properties.painScore }, geometry: feature.geometry })));
  map.setFilter("stretch-hi", ["==", ["get", "id"], SHOWN]);
  const shown = mujPain.features.find((feature) => feature.properties.stretchId === SHOWN);
  if (!shown) return;
  const tag = document.createElement("span");
  tag.className = "bg-ink px-2 py-1 text-[13px] font-bold text-white";
  tag.textContent = "This path";
  new maplibregl.Marker({ element: tag, anchor: "left", offset: [14, 0] }).setLngLat(midpoint(shown.geometry)).addTo(map);
}

// Sign in (P1): the real heat-pain map on the left, what the portal does and the sign-in button on the right
export default function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  const [demoFailed, setDemoFailed] = useState(false);
  const next = location.state?.next || "/";
  const shown = mujPain.features.find((feature) => feature.properties.stretchId === SHOWN)?.properties;

  return (
    <div className="grid h-full grid-cols-[1fr_600px]">
      <div className="relative">
        <MapView center={MAP_CENTER} zoom={MAP_ZOOM} onReady={drawPain} interactive={false} />
        {shown && (
          <div className="absolute bottom-6 left-6 z-[2] max-w-[380px] border-2 border-ink bg-white px-4 py-3 text-[13.5px] text-muted">
            <b className="block text-[16px] text-ink">{shown.name}, Dehmi Kalan</b>
            About {shown.walkersPerDay.toLocaleString("en-IN")} people a day walk this {shown.lengthM} m path. In May, {Math.round(shown.sunShare * 100)}% of it is in direct sun from 10 AM to 4 PM.
          </div>
        )}
      </div>
      <div className="flex flex-col overflow-y-auto bg-ink px-14 pt-10 pb-11 text-white">
        <div className="cond flex items-center gap-2.5 text-[23px]">
          <img src="/favicon.svg" alt="" className="size-6" />
          SunSkip
        </div>
        <h1 className="cond mt-auto text-[84px] leading-[0.86]">
          Where people walk in the sun<em className="text-high not-italic">.</em>
        </h1>
        <ul className="mt-7.5 border-t border-barline">
          {DOES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="grid grid-cols-[28px_1fr] gap-3 border-b border-barline py-3.5 text-bartext">
              <Icon size={20} weight="bold" className="mt-px text-high" />
              <span>
                <b className="font-bold text-white">{title}</b> {text}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-7.5 grid max-w-[400px] gap-3">
          {DEMO.email && DEMO.password && <DemoAccount next={next} onSignedIn={(page) => navigate(page, { replace: true })} onFailed={() => setDemoFailed(true)} />}
          <button type="button" onClick={() => login(next)} className="flex min-h-[58px] items-center justify-center gap-2.5 bg-white px-7 text-[16.5px] font-bold text-ink hover:bg-hover">
            <SignIn size={20} weight="bold" />
            Sign in with your city account
          </button>
        </div>
        {demoFailed && <p className="mt-3 text-[13px] text-[#F5A3A3]">The demo sign-in didn't work. Try again, or use the city sign-in.</p>}
        <p className="mt-4 max-w-[46ch] text-[13px] text-bartext">
          The city sign-in opens the secure AWS login page and comes back here. For city, campus and transit teams; ask your SunSkip contact for an account.
        </p>
      </div>
    </div>
  );
}
