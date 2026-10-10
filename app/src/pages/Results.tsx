import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { CaretRight, ChatCircleDots, CloudSlash, HourglassMedium, MapPin, Signpost, Warning, WifiSlash } from "@phosphor-icons/react";
import { api } from "../api/client";
import useShadeJob from "../api/useShadeJob";
import { isLive } from "../api/live";
import { boundsOf, optionLines } from "../geo";
import { dayLabel, duration, errorMessage, istIso, now, shortTime, timeOf } from "../format";
import { planRequest, recall } from "../session";
import MapView from "../components/MapView";
import TopBar from "../components/TopBar";
import Sheet from "../components/Sheet";
import RoundButton from "../components/RoundButton";
import Button from "../components/Button";
import HeatLine from "../components/HeatLine";
import HeatSheet from "../components/HeatSheet";
import RouteCard from "../components/RouteCard";
import ShadeNotice from "../components/ShadeNotice";
import StateMessage from "../components/StateMessage";
import OptionDetail from "./OptionDetail";
import ChatPanel from "../features/agent/ChatPanel";

const START_ZOOM = 14.5;
const STATE_ICON_PX = 30;

function failureOf(err) {
  if (err.response?.status === 422) return { kind: "noroute", message: "" };
  if (!err.response || err.response.status >= 500) return { kind: "offline", message: "" };
  return { kind: "other", message: errorMessage(err) };
}

// Why there is no shade data, in the words of the "No shade data" notice (api.md §4 Shade.reason)
const NO_SHADE_TEXT = {
  OUTSIDE_INDIA: "SunSkip has shade data only in India, so minutes in sun are unknown here.",
  NO_DATA: "Google has no shade data for this area, so minutes in sun are unknown.",
  BUDGET: "SunSkip can't fetch shade for new areas right now, so minutes in sun are unknown.",
};
const NO_SHADE_FALLBACK = "There is no shade data for this area, so minutes in sun are unknown.";

// Route options (screens 06 to 09 and 23 to 25), and one option's detail at /results/:optionId
export default function Results() {
  const navigate = useNavigate();
  const { optionId } = useParams();
  const [params, setParams] = useSearchParams();
  const [search] = useState(() => recall("search"));
  // The last plan request is kept so a re-plan sends the same body (TRD §3)
  const [request, setRequest] = useState(null);
  const [plan, setPlan] = useState(null);
  const [points, setPoints] = useState([]);
  const [lines, setLines] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [heatOpen, setHeatOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [askLive, setAskLive] = useState(false);
  const { progress, gaveUp } = useShadeJob(plan?.shade, replan);
  const hasSearch = Boolean(search?.origin && search?.destination);
  const options = plan?.options || [];
  const shown = options.find((option) => option.optionId === optionId) || options[0];

  useEffect(() => {
    if (!hasSearch) {
      navigate("/", { replace: true });
      return;
    }
    setLoading(true);
    setFailure(null);
    const body = planRequest(search.origin, search.destination, search.at || istIso(now()), search.when === "arrive");
    setRequest(body);
    api
      .post("/routes/plan", body)
      .then((res) => (res.data.options.length ? setPlan(res.data) : setFailure({ kind: "noroute", message: "" })))
      .catch((err) => setFailure(failureOf(err)))
      .finally(() => setLoading(false));
  }, [attempt]);

  useEffect(() => {
    isLive("agent").then(setAskLive);
  }, []);

  useEffect(() => {
    setPoints([]);
    if (!shown) return;
    api
      .get(`/routes/${plan.tripId}/options/${shown.optionId}/waypoints`)
      .then((res) => setPoints(res.data.waypoints))
      .catch((err) => err.response?.status === 404 && planAgain());
  }, [plan?.tripId, shown?.optionId]);

  useEffect(() => {
    setLines(shown ? optionLines(shown, points) : null);
  }, [shown, points]);

  // The shade data is in: the same request again now comes back ranked by sun
  function replan() {
    api
      .post("/routes/plan", request)
      .then((res) => setPlan(res.data))
      .catch(() => {}); // keep the plain routes that are already on screen
  }

  // A trip is kept for 30 minutes; after that (404) the search runs again
  function planAgain() {
    navigate("/results", { replace: true });
    setAttempt(attempt + 1);
  }

  if (!hasSearch) return null;

  const { origin, destination } = search;
  const preparing = plan?.shade.status === "PREPARING" && !gaveUp;
  const cellsDone = progress?.cellsDone ?? plan?.shade.cellsDone;
  const cellsTotal = progress?.cellsTotal ?? plan?.shade.cellsTotal;
  // For "arrive by" the API picks the leave time; every option leaves then
  const departAt = plan?.options[0]?.departAt || request?.departAt || istIso(now());
  const whenText = search.when === "arrive" ? `arrive by ${shortTime(search.at)}` : search.when === "leave" ? `leave at ${shortTime(search.at)}` : `leave now, ${shortTime(departAt)}`;
  const detail = optionId && shown?.optionId === optionId && !loading && !failure;
  const tripCoords = shown ? shown.legs.flatMap((leg) => leg.polyline.coordinates) : [];
  const showList = plan && !loading && !failure;

  return (
    <main>
      <MapView
        camera={shown && showList ? { bounds: boundsOf(tripCoords) } : { center: [origin.lng, origin.lat], zoom: START_ZOOM }}
        padding={{ top: 90, bottom: sheetHeight + 24, left: 36, right: 36 }}
        streets={null}
        lines={showList ? lines : null}
        start={[origin.lng, origin.lat]}
        end={showList && tripCoords.length ? tripCoords[tripCoords.length - 1] : null}
        you={null}
        creditBottom={sheetHeight + 6}
        onMoved={null}
      />
      <TopBar
        title={destination.name}
        subtitle={detail ? `Arrive ${timeOf(shown.arriveAt)} · ${duration(shown.durationSeconds)}` : `From ${origin.name || "your location"} · ${whenText}`}
        onBack={() => navigate(detail ? "/results" : "/")}
      >
        {askLive && !detail && (
          <RoundButton label="Ask SunSkip" onClick={() => setParams({ ask: "text" })}>
            <ChatCircleDots size={22} weight="bold" />
          </RoundButton>
        )}
      </TopBar>

      {detail ? (
        <OptionDetail tripId={plan.tripId} option={shown} points={points} search={search} onResize={setSheetHeight} onExpired={planAgain} />
      ) : (
        <Sheet label="Route options" className="top-[34%] overflow-y-auto overscroll-contain pb-6" onResize={setSheetHeight}>
          <HeatLine conditions={plan?.conditions} when={search.when === "now" ? "now" : `at ${shortTime(departAt)}`} onOpen={() => setHeatOpen(true)} />

          {loading && (
            <div aria-label="Finding routes">
              <p className="mx-5 mt-4 text-[15px] text-muted">Finding routes and checking the sun on every walk…</p>
              {[0, 1, 2].map((card) => (
                <div key={card} className="mx-4 mt-2.5 grid gap-2.5 rounded-2xl border border-line p-4">
                  <i className="shimmer block h-3 w-2/5 rounded-md" />
                  <i className="shimmer block h-7 w-3/4 rounded-md" />
                  <i className="shimmer block h-3 w-[55%] rounded-md" />
                </div>
              ))}
            </div>
          )}

          {failure?.kind === "noroute" && (
            <StateMessage icon={<Signpost size={STATE_ICON_PX} weight="bold" />} title="No route found" text="We couldn't find a way between these places. Try picking the start and the destination on the map.">
              <Button className="mt-1" onClick={() => navigate("/search?pick=to")}>
                <MapPin size={20} weight="bold" />
                Pick the places on the map
              </Button>
              <Button ghost onClick={() => navigate("/search")}>
                Change destination
              </Button>
            </StateMessage>
          )}
          {failure?.kind === "offline" && (
            <StateMessage icon={<WifiSlash size={STATE_ICON_PX} weight="bold" />} title="Can't reach SunSkip" text="Check your internet connection and try again. Your search is kept.">
              <Button className="mt-1" onClick={() => setAttempt(attempt + 1)}>
                Try again
              </Button>
            </StateMessage>
          )}
          {failure?.kind === "other" && (
            <StateMessage icon={<Warning size={STATE_ICON_PX} weight="bold" />} title="Can't plan this trip" text={`${failure.message}. Change the destination or try again.`}>
              <Button className="mt-1" onClick={() => setAttempt(attempt + 1)}>
                Try again
              </Button>
              <Button ghost onClick={() => navigate("/search")}>
                Change destination
              </Button>
            </StateMessage>
          )}

          {showList && (
            <>
              {preparing && (
                <ShadeNotice
                  icon={<HourglassMedium size={20} weight="bold" />}
                  title="Preparing shade data for this area…"
                  text={`${cellsTotal ? `${cellsDone} of ${cellsTotal} map areas ready. ` : ""}For now the routes are ranked by time and fare; the ones with the least sun will appear here by themselves.`}
                  done={cellsDone}
                  total={cellsTotal}
                />
              )}
              {plan.shade.status === "PREPARING" && gaveUp && (
                <ShadeNotice
                  icon={<HourglassMedium size={20} weight="bold" />}
                  title="Shade data is taking longer than usual"
                  text="These routes are ranked by time and fare, and minutes in sun are unknown for now. Search again in a few minutes."
                />
              )}
              {plan.shade.status === "UNAVAILABLE" && (
                <ShadeNotice
                  icon={<CloudSlash size={20} weight="bold" />}
                  title="No shade data here"
                  text={`${NO_SHADE_TEXT[plan.shade.reason] || NO_SHADE_FALLBACK} Times, fares and the best time to leave (from the sun's angle and the temperature) still work.`}
                />
              )}
              <div className="mx-5 mt-[18px] mb-0.5 flex items-baseline justify-between">
                <h2 className="text-[17px] leading-[1.3] font-[650]">{options.length === 1 ? "1 way to go" : `${options.length} ways to go`}</h2>
                <span className="text-[14px] text-muted">{preparing ? "By time and fare for now" : "Best match first"}</span>
              </div>
              {options.map((option, i) => (
                <RouteCard
                  key={plan.tripId + option.optionId}
                  option={option}
                  index={i}
                  top={i === 0 && !preparing}
                  waiting={preparing}
                  onOpen={() => navigate(`/results/${option.optionId}`)}
                />
              ))}
              <button type="button" onClick={() => navigate("/best-time")} className="mx-5 mt-2 flex min-h-12 w-[calc(100%-40px)] items-center justify-between font-[650] text-shade-text">
                Best time to leave
                <CaretRight size={20} weight="bold" />
              </button>
            </>
          )}
        </Sheet>
      )}

      {params.has("ask") && (
        <ChatPanel
          tripId={plan?.tripId || null}
          location={{ lat: origin.lat, lng: origin.lng }}
          about={`Answers use your trip's real numbers: ${origin.name || "your location"} to ${destination.name}, ${dayLabel(departAt)}.`}
          listen={params.get("ask") === "voice"}
          onClose={() => navigate(-1)}
        />
      )}
      {heatOpen && <HeatSheet place={origin} placeName={origin.name || "Your location"} at={departAt} onClose={() => setHeatOpen(false)} />}
    </main>
  );
}
