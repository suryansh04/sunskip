import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, WifiSlash } from "@phosphor-icons/react";
import { api } from "../api/client";
import { dayLabel, errorMessage, fmt, hourLabel, hourOf, istIso, now } from "../format";
import { bestTimeRequest, recall, remember } from "../session";
import RoundButton from "../components/RoundButton";
import Button from "../components/Button";
import StateMessage from "../components/StateMessage";

const FIRST_HOUR = 7;
const LAST_HOUR = 19;
const GROW_STEP_MS = 35;
const MIN_BAR_PCT = 2;

// Best time to leave (screen 17): one bar per hour. With ?for=walk it is about the walk being looked at,
// otherwise about the whole trip. Tapping an hour plans the trip (or the walk) for that hour.
export default function BestTime() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const forWalk = params.get("for") === "walk";
  const [trip] = useState(() => {
    const walk = recall("walk");
    const search = recall("search");
    if (forWalk && walk) return { origin: walk.from, destination: walk.to, dayIso: walk.at };
    if (search?.origin && search?.destination) return { origin: search.origin, destination: search.destination, dayIso: search.at || istIso(now()) };
    return null;
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!trip) {
      navigate("/", { replace: true });
      return;
    }
    setLoading(true);
    setError("");
    api
      .post("/routes/best-time", bestTimeRequest(trip.origin, trip.destination, trip.dayIso, FIRST_HOUR, LAST_HOUR))
      .then((res) => setData(res.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [attempt]);

  function leaveAt(departAt) {
    if (forWalk) {
      remember("walk", { ...recall("walk"), at: departAt });
      return navigate(-1);
    }
    remember("search", { ...recall("search"), when: "leave", at: departAt });
    navigate("/results");
  }

  if (!trip) return null;

  const nowIso = istIso(now());
  const estimate = data?.basis === "TEMPERATURE_ONLY";
  const valueOf = (slot) => (estimate ? slot.heatDose : slot.sunMinutes);
  const slots = data?.slots || [];
  const known = slots.filter((slot) => valueOf(slot) !== null);
  const largest = Math.max(...known.map(valueOf), 0.1);
  const best = data?.best ? slots.find((slot) => slot.departAt === data.best.departAt) : null;
  const nextBest = known.filter((slot) => slot !== best).sort((a, b) => valueOf(a) - valueOf(b)).slice(0, 2);

  return (
    <main className="absolute inset-0 animate-forward overflow-y-auto bg-paper">
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-1">
        <RoundButton flat label="Back" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} weight="bold" />
        </RoundButton>
        <h1 className="text-[22px] leading-[1.2] font-bold [font-stretch:112%]">Best time to leave</h1>
      </div>
      <p className="mx-5 mt-1.5 text-[15px] text-muted">
        {`${trip.origin.name || "Your location"} to ${trip.destination.name} · ${dayLabel(trip.dayIso)} · minutes in direct sun on the walking parts`}
      </p>

      {loading && (
        <div className="mx-4 mt-4 grid gap-3" aria-label="Loading the best time">
          <i className="shimmer block h-20 rounded-[14px]" />
          <i className="shimmer block h-80 rounded-[14px]" />
          <p className="mx-1 text-[14px] text-muted">Checking the sun for every hour of the day…</p>
        </div>
      )}
      {error && (
        <StateMessage icon={<WifiSlash size={30} weight="bold" />} title="Can't load the best time" text={`${error}. Check your internet connection and try again.`}>
          <Button className="mt-1" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </StateMessage>
      )}
      {data && !loading && !error && slots.length === 0 && <p className="mx-5 mt-6 text-[15px] text-muted">No hours to compare for this trip. Each hour's minutes in sun will show here.</p>}

      {data && !loading && !error && slots.length > 0 && (
        <>
          <div className="mx-4 mt-4 rounded-[14px] bg-shade-tint px-[18px] py-4 text-shade-text">
            {best ? (
              <>
                <b className="block text-[22px] leading-[1.25] font-[720] [font-stretch:112%]">
                  {estimate ? `${hourLabel(hourOf(best.departAt))} looks coolest` : `${hourLabel(hourOf(best.departAt))}: ${fmt(best.sunMinutes)} min in sun`}
                  {estimate && <span className="ml-2 rounded-md bg-white px-1.5 py-0.5 align-middle text-[13px] font-[650] [font-stretch:100%]">estimate</span>}
                </b>
                <span className="text-[15px]">
                  {estimate
                    ? "There is no shade data for this trip, so minutes in sun are unknown. The bars compare the hours by the sun's angle and the temperature."
                    : `The least sun all day. Next best: ${nextBest.map((slot) => `${hourLabel(hourOf(slot.departAt))} (${fmt(slot.sunMinutes)} min)`).join(", then ")}.`}
                </span>
              </>
            ) : (
              <span className="text-[15px]">Minutes in sun are unknown for this trip, so the hours can't be compared.</span>
            )}
          </div>

          <div className="mx-4 mt-3.5 rounded-[14px] bg-white px-4 py-1">
            {slots.map((slot, i) => {
              const isBest = slot === best;
              const value = valueOf(slot);
              return (
                <button
                  key={slot.departAt}
                  type="button"
                  disabled={slot.departAt < nowIso.slice(0, 13)}
                  onClick={() => leaveAt(slot.departAt)}
                  className="grid min-h-12 w-full grid-cols-[76px_1fr_auto] items-center gap-3 border-line not-first:border-t disabled:opacity-50"
                >
                  <span className={`text-[15px] font-[650] ${isBest ? "text-shade-text" : ""}`}>
                    {hourLabel(hourOf(slot.departAt))}
                    {slot.departAt.slice(0, 13) === nowIso.slice(0, 13) && <span className="text-[13px] font-medium text-muted"> now</span>}
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-[5px] bg-sunken">
                    {value !== null && (
                      <span
                        className={`block h-full origin-left animate-grow rounded-[5px] ${isBest ? "bg-shade" : "bg-sun"}`}
                        style={{ width: `${Math.max(MIN_BAR_PCT, (100 * value) / largest)}%`, animationDelay: `${i * GROW_STEP_MS}ms` }}
                      />
                    )}
                  </span>
                  {slot.sunMinutes === null ? (
                    <span className="text-right text-[13px] text-muted">unknown</span>
                  ) : (
                    <span className={`min-w-11 text-right text-[17px] font-bold ${isBest ? "text-shade-text" : ""}`}>{fmt(slot.sunMinutes)}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mx-5 mt-3.5 mb-6 text-[14px] text-muted">{`${data.note} Tap an hour to plan for it.`}</p>
        </>
      )}
    </main>
  );
}
