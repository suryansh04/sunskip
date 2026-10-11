import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { ArrowsClockwise, CurrencyInr, HourglassMedium, Tree, Umbrella, WifiSlash, XCircle } from "@phosphor-icons/react";
import { api } from "../api/client";
import useShadeJob from "../api/useShadeJob";
import { PAIN_COLOR } from "../bands";
import { MONTHS, errorMessage, inr, shortInr, stretchName } from "../format";
import { COST_SOURCES } from "../costs";
import { fitTo, flatCoords, setSource, showLayers } from "../map";
import PanelHead from "../components/PanelHead";
import MonthPicker, { HOTTEST_MONTH } from "../components/MonthPicker";
import RecRow from "../components/RecRow";
import SkeletonRows from "../components/SkeletonRows";
import StateMessage from "../components/StateMessage";

const BUDGETS = [50000, 200000, 1000000, 2500000]; // up to a few steel shelters (₹7.5 lakh each)
const RANKED = { hours: "10-16", limit: 50 }; // the ranking the recommendations come from
const OPEN_ZOOM = 17;
const LAYERS = ["stretches", "stretch-hi", "pins"];
const PIN_COLOR = { TREE: ["#3D6A2B", "#A9C79A"], SHELTER: ["#1E6FD9", "#A9C6F0"] }; // open, others

// The plan that fits the budget: the ranked list taken in order, skipping what no longer fits
// (the same rule as the API's budgetInr, so typing a budget needs no new request)
function withinBudget(recs, budget) {
  if (!budget) return recs;
  let spent = 0;
  return recs.filter((rec) => {
    if (spent + rec.costInr > budget) return false;
    spent += rec.costInr;
    return true;
  });
}

function Choice({ on, label, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-[62px] flex-1 flex-col justify-center border-r border-line px-4 py-2.5 text-left text-[12.5px] transition-colors last:border-r-0 ${on ? "bg-ink text-bartext" : "text-muted hover:bg-hover"}`}
    >
      {label}
      <b className={`flex items-center gap-1.5 text-[15px] ${on ? "text-white" : "text-ink"}`}>{children}</b>
    </button>
  );
}

// Trees and shelters (P3): where a row of trees or a shelter saves the most sun-minutes per rupee
export default function Recommendations() {
  const { map, area } = useOutletContext<any>();
  const navigate = useNavigate();
  const [type, setType] = useState("TREE");
  const [budget, setBudget] = useState(0);
  const [month, setMonth] = useState(HOTTEST_MONTH);
  const [openIndex, setOpenIndex] = useState(0);
  const [recs, setRecs] = useState(null);
  const [stretches, setStretches] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waitingJob, setWaitingJob] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [hover, setHover] = useState(null);
  useShadeJob(waitingJob ? { status: "PREPARING", jobId: waitingJob } : null, () => setAttempt((n) => n + 1));

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setRecs(null);
    Promise.all([api.get("/portal/recommendations", { params: { bbox: area.bbox, type, month, hours: RANKED.hours } }), api.get("/portal/heat-pain", { params: { bbox: area.bbox, month, ...RANKED } })])
      .then(([recRes, painRes]) => {
        if (!current) return;
        setRecs(recRes.data.recommendations);
        setStretches(Object.fromEntries(painRes.data.features.map((feature) => [feature.properties.stretchId, feature])));
        setWaitingJob(null);
      })
      .catch((err) => {
        if (!current) return;
        if (err.response?.status === 409) setWaitingJob(err.response.data.error.jobId);
        else setError(errorMessage(err));
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [area.key, type, month, attempt]);

  const plan = withinBudget(recs || [], budget);
  const open = plan[openIndex];
  const nameOf = (stretchId) => stretchName(stretches[stretchId]?.properties);

  // Pins for every place in the plan (the open one large), and the stretches they shade
  useEffect(() => {
    if (!map) return;
    showLayers(map, LAYERS);
    map.setFilter("stretches", null);
    map.setPaintProperty("stretches", "line-color", ["case", ["==", ["get", "id"], open?.stretchId || ""], "#E8590C", "#F3C9A3"]);
    setSource(
      map,
      "stretches",
      plan.filter((rec) => stretches[rec.stretchId]).map((rec) => ({ type: "Feature", properties: { id: rec.stretchId, pain: null }, geometry: stretches[rec.stretchId].geometry })),
    );
    setSource(
      map,
      "pins",
      plan.flatMap((rec, i) =>
        rec.positions.map((position) => ({
          type: "Feature",
          properties: { open: i === openIndex ? 1 : 0, color: PIN_COLOR[rec.type][i === openIndex ? 0 : 1] },
          geometry: { type: "Point", coordinates: [position.lng, position.lat] },
        })),
      ),
    );
    if (open) {
      const line = stretches[open.stretchId] ? flatCoords(stretches[open.stretchId].geometry) : [];
      fitTo(map, [...open.positions.map((position) => [position.lng, position.lat]), ...line], OPEN_ZOOM, { pitch: 0, bearing: 0 });
    }
    return () => {
      map.setPaintProperty("stretches", "line-color", PAIN_COLOR);
      setSource(map, "stretches", []);
      setSource(map, "pins", []);
    };
  }, [map, recs, stretches, budget, openIndex]);

  useEffect(() => {
    if (map) map.setFilter("stretch-hi", ["==", ["get", "id"], hover || ""]);
  }, [map, hover]);

  function chooseMonth(next) {
    setMonth(next);
    setOpenIndex(0);
  }

  function chooseType(next) {
    setType(next);
    setOpenIndex(0);
  }

  function chooseBudget(next) {
    setBudget(next);
    setOpenIndex(0);
  }

  const cheapest = recs?.length ? Math.min(...recs.map((rec) => rec.costInr)) : null;
  const typeWord = type === "TREE" ? "tree plan" : "shelter";

  return (
    <aside className="flex min-h-0 flex-col border-l-2 border-ink bg-white">
      <PanelHead title="Trees + shelters">
        Where a row of trees or a shelter saves the most sun-minutes per rupee, 10 AM – 4 PM in {MONTHS[month - 1]}
        {month === HOTTEST_MONTH ? ", the hottest month" : ""}.
      </PanelHead>
      <div className="flex border-b border-line">
        <Choice on={type === "TREE"} label="Plant" onClick={() => chooseType("TREE")}>
          <Tree size={16} weight="bold" />
          Trees
        </Choice>
        <Choice on={type === "SHELTER"} label="Build" onClick={() => chooseType("SHELTER")}>
          <Umbrella size={16} weight="bold" />
          Shelters
        </Choice>
        <MonthPicker month={month} onMonth={chooseMonth} className="flex-[1.2]" />
      </div>
      <div className="flex border-b border-line">
        <label className="flex min-h-[62px] flex-[1.4] border-r border-line flex-col justify-center px-4 py-2.5 text-[12.5px] text-muted">
          Budget
          <span className="flex items-center gap-1 text-[15px] font-bold text-ink">
            ₹
            <input
              inputMode="numeric"
              placeholder="Any"
              value={budget ? inr(budget) : ""}
              onChange={(event) => chooseBudget(Number(event.target.value.replace(/[^0-9]/g, "")) || 0)}
              aria-label="Budget in rupees"
              className="w-full bg-transparent tabular-nums outline-none placeholder:font-semibold placeholder:text-muted"
            />
            {budget > 0 && (
              <button type="button" aria-label="Clear budget" onClick={() => chooseBudget(0)} className="grid text-muted">
                <XCircle size={16} weight="fill" />
              </button>
            )}
          </span>
        </label>
        {BUDGETS.map((amount) => (
          <button
            key={amount}
            type="button"
            aria-pressed={budget === amount}
            onClick={() => chooseBudget(amount)}
            className={`min-h-11 flex-1 border-r border-line text-[15px] font-bold last:border-r-0 ${budget === amount ? "bg-ink text-white" : "hover:bg-hover"}`}
          >
            ₹{shortInr(amount)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {waitingJob && (
          <StateMessage icon={<HourglassMedium size={40} weight="bold" />} title="Getting this area ready" text="Shade data for this area is being fetched. The recommendations show once it is ready." />
        )}
        {error && !waitingJob && (
          <StateMessage icon={<WifiSlash size={40} weight="bold" />} title="Can't reach SunSkip" text={`${error}. Check your connection and try again. Your choices are kept.`}>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex min-h-[46px] items-center gap-2 bg-ink px-5 font-bold text-white">
              <ArrowsClockwise size={18} weight="bold" />
              Try again
            </button>
          </StateMessage>
        )}
        {loading && !error && !waitingJob && <SkeletonRows />}
        {recs && !recs.length && (
          <StateMessage
            icon={<Tree size={40} weight="bold" />}
            title={`No ${typeWord}s here yet`}
            text="Recommendations need stretches with people-a-day estimates. They come from the nightly demand job, or as people plan trips here."
          />
        )}
        {recs?.length > 0 && !plan.length && (
          <StateMessage icon={<CurrencyInr size={40} weight="bold" />} title={`No plan fits ₹${inr(budget)}`} text={`The cheapest ${typeWord} here costs ₹${inr(cheapest)}. Raise the budget or clear it.`}>
            <button type="button" onClick={() => chooseBudget(0)} className="min-h-[46px] bg-white px-5 font-bold shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-hover">
              Clear budget
            </button>
          </StateMessage>
        )}
        {plan.length > 0 && budget > 0 && (
          <div className="flex border-b border-line bg-hover">
            <div className="flex flex-1 flex-col px-6.5 py-3">
              <span className="num text-[28px] leading-tight">₹{inr(plan.reduce((sum, rec) => sum + rec.costInr, 0))}</span>
              <small className="text-[12px] text-muted">for these {plan.length} places (estimate)</small>
            </div>
            <div className="flex flex-1 flex-col border-l border-line px-6.5 py-3">
              <span className="num text-[28px] leading-tight">{inr(plan.reduce((sum, rec) => sum + (rec.impact.sunMinutesSavedPerDay || 0), 0))}</span>
              <small className="text-[12px] text-muted">sun-minutes saved a day</small>
            </div>
          </div>
        )}
        {plan.map((rec, i) => (
          <RecRow
            key={rec.type + rec.stretchId}
            rec={rec}
            rank={i + 1}
            name={nameOf(rec.stretchId)}
            open={i === openIndex}
            onOpen={() => setOpenIndex(i)}
            onHover={setHover}
            onTry={() => navigate("/simulate", { state: { rec, name: nameOf(rec.stretchId) } })}
            onEvidence={() => navigate(`/stretch/${rec.stretchId}`, { state: { from: "recs" } })}
          />
        ))}
        {plan.length > 0 && (
          <p className="px-6.5 pt-3 pb-6 text-[11.5px] leading-normal text-muted">
            Each tree is priced as a neem, the hardiest roadside tree for Jaipur: an 8–10 ft sapling planted with a guard and three years of care (₹2,000), each shelter as a powder-coated steel bus shelter (₹7.5 lakh).
            The simulator compares species and shelter types. {COST_SOURCES}
          </p>
        )}
      </div>

      <div className="absolute top-5 left-5 z-[3] flex border-2 border-ink bg-white text-[12px] font-bold">
        <span className="flex items-center gap-1.5 px-3 py-2">
          <i className="size-3.5 rounded-full" style={{ background: PIN_COLOR[type][0] }} />
          {type === "TREE" ? "New tree" : "New shelter"}
        </span>
        <span className="flex items-center gap-1.5 border-l border-line px-3 py-2">
          <i className="size-3.5 bg-high" />
          Stretch it shades
        </span>
      </div>
    </aside>
  );
}
