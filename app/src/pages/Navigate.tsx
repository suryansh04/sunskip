import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ClockCounterClockwise, CubeFocus, MapTrifold, PersonSimpleWalk, WifiSlash, X } from "@phosphor-icons/react";
import { api } from "../api/client";
import { bboxAround, metersLeft, nextInstruction, stretchAhead, sunBit, sunMinutesLeft, walkPieces, WALK_SPEED_MPS } from "../geo";
import { errorMessage, fmt, hourOf, istIso, now, timeOf } from "../format";
import MapView from "../components/MapView";
import Sheet from "../components/Sheet";
import Button from "../components/Button";
import Segmented from "../components/Segmented";
import SunStrip from "../components/SunStrip";
import AheadCard from "../components/AheadCard";
import ArrowBackup from "../components/ArrowBackup";
import InstructionBanner from "../components/InstructionBanner";
import StateMessage from "../components/StateMessage";
import RideGuide from "../components/RideGuide";
import useReroute from "../api/useReroute";
import { recall } from "../session";
import SpokenDirections from "../features/voice/SpokenDirections";
import { createFixSmoother, watchGps } from "../features/ar/gps";
import { bearingAt, buildRoute, snapToRoute, waypointAt } from "../features/ar/route";
import { SNAP_MAX_OFFSET_M } from "../features/ar/config";

// three.js and LocAR load only when the AR view opens
const ARView = lazy(() => import("../features/ar/index.ts").then((ar) => ({ default: ar.ARView })));

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const MOCK_STEP = 6; // with mocks there is no GPS: the walker stands 6 waypoints (150 m) in, as in the screens PDF
const NAV_ZOOM = 17.4;
const NAV_PITCH = 52;
const STREET_OPACITY = 0.5;
const WEAK_GPS_M = 30; // above this the fix could be on the next street, so say so
const VIEWS = [
  { value: "map", label: "Map", icon: <MapTrifold size={20} weight="bold" /> },
  { value: "ar", label: "AR", icon: <CubeFocus size={20} weight="bold" /> },
];

// Navigate (screens 14 to 16): ?view=map | ar | arrow over the same waypoints, one walk leg at a time (?leg=)
export default function Navigate() {
  const { tripId, optionId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const view = params.get("view") || "map";
  const leaveAt = params.get("at"); // a later start picked on the walk screen: the sun is shown for then
  const [waypoints, setWaypoints] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [fix, setFix] = useState(null);
  const [gpsOff, setGpsOff] = useState(false);
  const [snap, setSnap] = useState(null);
  const [route, setRoute] = useState(null);
  const [streets, setStreets] = useState(null);
  const [lines, setLines] = useState(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [sheetHeight, setSheetHeight] = useState(0);

  const walkLegs = [...new Set((waypoints || []).map((point) => point.legIndex))];
  const legIndex = params.has("leg") ? Number(params.get("leg")) : walkLegs[0];
  const planKey = `${waypoints?.length}/${legIndex}`;
  const planned = (waypoints || []).filter((point) => point.legIndex === legIndex);
  const { reroute, rerouting } = useReroute(fix, snap, planned[planned.length - 1]?.location, planKey);
  // After a wrong turn the new walk from where the walker is replaces this leg
  const points = reroute ? reroute.points : planned;
  const legKey = reroute ? reroute.tripId : planKey;

  useEffect(() => {
    setLoading(true);
    setFailure(null);
    api
      .get(`/routes/${tripId}/options/${optionId}/waypoints`, { params: leaveAt ? { at: leaveAt } : {} })
      .then((res) => setWaypoints(res.data.waypoints))
      .catch((err) => setFailure({ expired: err.response?.status === 404, message: errorMessage(err) }))
      .finally(() => setLoading(false));
  }, [tripId, optionId, attempt]);

  useEffect(() => {
    if (USE_MOCKS) return;
    const smoother = createFixSmoother();
    let found = false;
    return watchGps(
      (raw) => {
        found = true;
        setGpsOff(false);
        const smoothed = smoother.push(raw);
        if (smoothed) setFix(smoothed);
      },
      // A timeout while standing still is normal, and so is a lost signal once we had one: keep the last fix
      (failure) => setGpsOff(failure === "denied" || failure === "unsupported" || (failure === "unavailable" && !found)),
    );
  }, []);

  // The route and the snap carry the key of the walk they belong to, so a new walk never meets the old one's progress
  useEffect(() => {
    setRoute({ key: legKey, path: buildRoute(points) });
  }, [legKey]);

  // Snap near where the walker last was, so a path that doubles back doesn't jump ahead
  useEffect(() => {
    if (!route?.path || !fix) return;
    setSnap((last) => ({ key: route.key, ...snapToRoute(route.path, fix, last?.key === route.key ? last.progressM : null) }));
  }, [route, fix]);
  const path = route?.key === legKey ? route.path : null;
  const snapped = path && snap?.key === legKey ? snap : null;

  useEffect(() => {
    setLines(points.length > 1 ? walkPieces(points) : null);
    if (points.length < 2) return;
    const nowIso = istIso(now());
    api
      .get("/shade/segments", { params: { bbox: bboxAround(points[Math.floor(points.length / 2)].location), month: Number(nowIso.slice(5, 7)), hour: hourOf(nowIso) } })
      .then((res) => setStreets(res.data))
      .catch(() => setStreets(null));
  }, [legKey]);

  function show(nextView, reason = "") {
    const next: any = { view: nextView };
    if (params.has("leg")) next.leg = params.get("leg");
    if (params.has("desk")) next.desk = params.get("desk");
    if (leaveAt) next.at = leaveAt;
    if (reason === "unavailable") next.camera = "off";
    setParams(next, { replace: true });
  }

  // Back to the route (or walk) the walker came from; home when this page was opened directly
  function endWalk() {
    if (location.key === "default") navigate("/");
    else navigate(-1);
  }

  const option = location.state?.option;
  if (!loading && !failure && points.length < 2 && option) {
    return <RideGuide option={option} destinationName={recall("search")?.destination?.name} onDone={endWalk} />;
  }
  if (loading || failure || points.length < 2) {
    return (
      <main className="absolute inset-0 bg-paper pt-16">
        {loading && <p className="mx-6 mt-10 text-center text-[16px] text-muted">Loading your walk…</p>}
        {failure?.expired && (
          <StateMessage icon={<ClockCounterClockwise size={30} weight="bold" />} title="This trip has expired" text="Trips are kept for 30 minutes. Plan it again to get fresh directions.">
            <Button className="mt-1" onClick={() => navigate("/results", { replace: true })}>
              Plan it again
            </Button>
          </StateMessage>
        )}
        {failure && !failure.expired && (
          <StateMessage icon={<WifiSlash size={30} weight="bold" />} title="Can't load the walk" text={`${failure.message}. Check your internet connection and try again.`}>
            <Button className="mt-1" onClick={() => setAttempt(attempt + 1)}>
              Try again
            </Button>
          </StateMessage>
        )}
        {!loading && !failure && (
          <StateMessage icon={<PersonSimpleWalk size={30} weight="bold" />} title="No walking on this route" text="This route has no part on foot, so there are no walking directions. Follow the steps of the route.">
            <Button className="mt-1" onClick={endWalk}>
              Back to the route
            </Button>
          </StateMessage>
        )}
      </main>
    );
  }

  const last = points.length - 1;
  const at = USE_MOCKS ? Math.min(Number(params.get("step") ?? MOCK_STEP), last) : snapped ? waypointAt(path, snapped.progressM) : 0;
  const arrived = at === last;
  const here = points[at];
  const onPath = snapped && snapped.offsetM <= SNAP_MAX_OFFSET_M;
  const youAt = !snapped ? here.location : onPath ? snapped.point : fix;
  const youBearing = snapped ? bearingAt(path, snapped.progressM) : here.bearingDeg;
  const gpsNote = gpsOff
    ? "Location is off, so your place on the walk isn't shown"
    : rerouting
      ? "You left the path. Finding a new way from here…"
      : !fix && !USE_MOCKS
        ? "Finding your location…"
        : fix && fix.accuracyM > WEAK_GPS_M
          ? `GPS is weak here (±${Math.round(fix.accuracyM)} m)`
          : snapped && !onPath
            ? `You're ${Math.round(snapped.offsetM)} m from the path`
            : "";
  const instruction = nextInstruction(points, at);
  const ahead = stretchAhead(points, at);
  const minutesToGo = Math.round(metersLeft(points, at) / WALK_SPEED_MPS / 60);
  const arrival = timeOf(istIso(new Date(now().getTime() + minutesToGo * 60000)));
  const nextLeg = walkLegs[walkLegs.indexOf(legIndex) + 1];
  const end = points[last].location;

  return (
    <main>
      {view === "map" && (
        <>
          <MapView
            camera={{ center: [youAt.lng, youAt.lat], zoom: NAV_ZOOM, pitch: NAV_PITCH, bearing: youBearing }}
            padding={{ top: 140, bottom: sheetHeight, left: 0, right: 0 }}
            streets={streets}
            streetOpacity={STREET_OPACITY}
            lines={lines}
            start={null}
            end={[end.lng, end.lat]}
            you={snapped || USE_MOCKS ? { at: [youAt.lng, youAt.lat], bearing: youBearing } : null}
            creditBottom={sheetHeight + 6}
            onMoved={null}
          />
          <Sheet label="Your walk" className="px-5 pt-1.5 pb-[calc(16px+env(safe-area-inset-bottom))]" onResize={setSheetHeight}>
            {gpsNote && <p className="mt-2 text-[13px] font-[650] text-alert">{gpsNote}</p>}
            <AheadCard ahead={ahead} className="mt-3" />
            <div className="mt-3.5 grid grid-cols-3">
              <div>
                <b className="wide block text-[24px] leading-[1.1] font-[720]">{fmt(sunMinutesLeft(points, at))}</b>
                <span className="text-[13px] text-muted">min in sun left</span>
              </div>
              <div className="border-l border-line pl-3.5">
                <b className="wide block text-[24px] leading-[1.1] font-[720]">{minutesToGo}</b>
                <span className="text-[13px] text-muted">min to go</span>
              </div>
              <div className="border-l border-line pl-3.5">
                <b className="wide block text-[24px] leading-[1.1] font-[720]">
                  {arrival.slice(0, -3)}
                  <small className="text-[15px] font-[650] [font-stretch:100%]">{arrival.slice(-3)}</small>
                </b>
                <span className="text-[13px] text-muted">arrival</span>
              </div>
            </div>
            <div className="relative mt-3.5">
              <SunStrip bits={points.map((point) => sunBit(point.inSun))} className="h-2" />
              <span className="absolute -top-1 size-4 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_3px_var(--color-ink)]" style={{ left: `${(100 * at) / last}%` }} />
            </div>
            {arrived && nextLeg !== undefined && (
              <Button className="mt-4" onClick={() => setParams({ leg: String(nextLeg), ...(leaveAt ? { at: leaveAt } : {}) }, { replace: true })}>
                Next walk of this trip
              </Button>
            )}
            <div className="mt-4 flex gap-2.5">
              <Segmented dark label="Map or AR view" className="flex-1" options={VIEWS} value="map" onChange={show} />
              <button type="button" aria-label="End walk" onClick={endWalk} className="press grid min-h-14 w-14 flex-none place-items-center rounded-[14px] bg-alert-tint text-alert">
                <X size={22} weight="bold" />
              </button>
            </div>
          </Sheet>
        </>
      )}

      {view === "ar" && (
        <Suspense fallback={<p className="absolute inset-0 grid place-items-center bg-ink text-[16px] text-white">Opening the camera…</p>}>
          <div className="fixed inset-0 z-40 animate-ar-open">
            <ARView key={legKey} waypoints={points} desk={params.get("desk") === "1"} onSwitchToMap={() => show("map")} onClose={endWalk} onUseArrow={(reason) => show("arrow", reason)} />
          </div>
        </Suspense>
      )}

      {view === "arrow" && (
        <ArrowBackup
          instruction={instruction}
          ahead={ahead}
          arrived={arrived}
          bearingDeg={here.bearingDeg}
          cameraOff={params.get("camera") === "off"}
          onTryAr={() => show("ar")}
          onMap={() => show("map")}
        />
      )}

      {view !== "ar" && <InstructionBanner instruction={instruction} arrived={arrived} voiceOn={voiceOn} onToggleVoice={() => setVoiceOn(!voiceOn)} />}
      <SpokenDirections
        key={legKey}
        tripId={reroute?.tripId || tripId}
        optionId={reroute?.optionId || optionId}
        points={points}
        at={at}
        muted={!voiceOn}
        caption={view !== "ar"}
        language={localStorage.getItem("language") || "hi-IN"}
      />
    </main>
  );
}
