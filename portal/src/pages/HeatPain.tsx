import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import maplibregl from "maplibre-gl";
import { ArrowsClockwise, DownloadSimple, HourglassMedium, MapTrifold, WifiSlash } from "@phosphor-icons/react";
import { api } from "../api/client";
import useShadeJob from "../api/useShadeJob";
import { BANDS, PAIN_COLOR } from "../bands";
import { MONTHS, errorMessage, hourLabel, inr } from "../format";
import { flyTo, midpoint, setSource, showLayers } from "../map";
import PanelHead from "../components/PanelHead";
import MonthPicker, { HOTTEST_MONTH } from "../components/MonthPicker";
import PainList from "../components/PainList";
import SkeletonRows from "../components/SkeletonRows";
import StateMessage from "../components/StateMessage";
import Meter from "../components/Meter";

const RANGE = "10-16"; // the ranked hours: May 10 AM – 4 PM is the worst case (api.md §8)
const FIRST_HOUR = 7;
const LAST_HOUR = 18;
const LIST_LIMIT = 50;
const TAGGED = 10;
const HOT_SHARE = 0.9;
const AREA_ZOOM = 15.1;
const LAYERS = ["stretch-hit", "stretch-hi", "stretches"];
const TAG_GAP_PX = 24; // two tags closer than this on screen would cover each other

// Parallel paths (a road and its footpath) put their tags on top of each other:
// keep the better-ranked tag in place and move the next one down until it is clear
function spreadTags(map, tags) {
  const placed = [];
  for (const tag of tags) {
    const at = map.project(tag.getLngLat());
    let shiftY = 0;
    while (placed.some((other) => Math.abs(other.x - at.x) < TAG_GAP_PX && Math.abs(other.y - (at.y + shiftY)) < TAG_GAP_PX)) shiftY += TAG_GAP_PX;
    tag.setOffset([0, shiftY]);
    placed.push({ x: at.x, y: at.y + shiftY });
  }
}

function painQuery(area, month, byHour, hour) {
  return { bbox: area.bbox, month, hours: byHour ? `${hour}-${hour}` : RANGE, limit: LIST_LIMIT };
}

function downloadCsv(rows, fileName) {
  const header = ["rank", "stretchId", "name", "label", "lengthM", "sunShare", "walkersPerDay", "walkersEstimated", "painScore"];
  const quote = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : value);
  const lines = rows.map((row) => [row.rank, row.stretchId, row.name || "", row.label || "", row.lengthM, row.sunShare ?? "", row.walkersPerDay ?? "", row.walkersEstimated, row.painScore ?? ""]);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([[header, ...lines].map((line) => line.map(quote).join(",")).join("\n")], { type: "text/csv" }));
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Heat pain (P2): the stretches where the most people walk in full sun, as bands in the panel and coloured lines on the map
export default function HeatPain() {
  const { map, area } = useOutletContext<any>();
  const navigate = useNavigate();
  const [month, setMonth] = useState(HOTTEST_MONTH);
  const [byHour, setByHour] = useState(false);
  const [hour, setHour] = useState(13);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waitingJob, setWaitingJob] = useState(null); // 409: nothing in the area is ready yet
  const [attempt, setAttempt] = useState(0);
  const [hover, setHover] = useState(null);
  const tags = useRef([]);

  const shadeJob = waitingJob ? { status: "PREPARING", jobId: waitingJob } : data?.shade;
  const { progress } = useShadeJob(shadeJob, () => setAttempt((n) => n + 1));

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api
      .get("/portal/heat-pain", { params: painQuery(area, month, byHour, hour) })
      .then((res) => {
        if (!current) return;
        setData(res.data);
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
  }, [area.key, month, byHour, hour, attempt]);

  const rows = (data?.features || []).map((feature, i) => ({ ...feature.properties, geometry: feature.geometry, rank: i + 1 }));

  // Coloured lines and the top-ten rank tags
  useEffect(() => {
    if (!map) return;
    showLayers(map, LAYERS);
    map.setFilter("stretches", null);
    map.setPaintProperty("stretches", "line-color", PAIN_COLOR);
    map.setPaintProperty("stretches", "line-opacity", 1);
    setSource(map, "stretches", rows.map((row) => ({ type: "Feature", properties: { id: row.stretchId, pain: row.painScore }, geometry: row.geometry })));
    tags.current = rows.slice(0, TAGGED).map((row) => {
      // MapLibre moves the marker with its transform, so the highlight goes on the inner label
      const tag = document.createElement("button");
      const label = document.createElement("span");
      label.className = "num block cursor-pointer bg-ink px-1.5 py-[3px] text-[15px] leading-none text-white transition-transform";
      label.textContent = row.rank;
      tag.append(label);
      tag.dataset.id = row.stretchId;
      tag.setAttribute("aria-label", `Open stretch ${row.rank}`);
      tag.onmouseenter = () => setHover(row.stretchId);
      tag.onmouseleave = () => setHover(null);
      tag.onclick = () => open(row.stretchId);
      return new maplibregl.Marker({ element: tag }).setLngLat(midpoint(row.geometry)).addTo(map);
    });
    const spread = () => spreadTags(map, tags.current);
    spread();
    map.on("zoomend", spread);
    return () => {
      map.off("zoomend", spread);
      tags.current.forEach((tag) => tag.remove());
      setSource(map, "stretches", []);
    };
  }, [map, data]);

  useEffect(() => {
    if (map) flyTo(map, area.center, AREA_ZOOM);
  }, [map, area.key]);

  // Hovering a line on the map highlights its row, and the other way round
  useEffect(() => {
    if (!map) return;
    const enter = (event) => {
      map.getCanvas().style.cursor = "pointer";
      setHover(event.features[0].properties.id);
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    };
    const click = (event) => open(event.features[0].properties.id);
    map.on("mousemove", "stretch-hit", enter);
    map.on("mouseleave", "stretch-hit", leave);
    map.on("click", "stretch-hit", click);
    return () => {
      map.off("mousemove", "stretch-hit", enter);
      map.off("mouseleave", "stretch-hit", leave);
      map.off("click", "stretch-hit", click);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    map.setFilter("stretch-hi", ["==", ["get", "id"], hover || ""]);
    for (const tag of tags.current) {
      const on = tag.getElement().dataset.id === hover;
      const label = tag.getElement().firstElementChild as HTMLElement;
      label.style.background = on ? "var(--color-high)" : "";
      label.style.transform = on ? "scale(1.3)" : "";
      tag.getElement().style.zIndex = on ? "1" : "";
    }
  }, [map, hover, data]);

  function open(stretchId) {
    navigate(`/stretch/${stretchId}`, { state: { from: "pain" } });
  }

  function chooseByHour(on) {
    setByHour(on);
    if (on) setMonth(HOTTEST_MONTH); // the hour slider is for May, the month the ranking uses
  }

  const top = rows.slice(0, TAGGED);
  const placeName = area.place.split(",")[0];
  const when = byHour ? `at ${hourLabel(hour)} in May, the hottest month` : `10 AM – 4 PM in ${MONTHS[month - 1]}${month === HOTTEST_MONTH ? ", the hottest month" : ""}`;
  const busy = loading && !data;
  const cellsTotal = progress?.cellsTotal || data?.shade?.cellsTotal;
  const cellsDone = progress?.cellsDone ?? data?.shade?.cellsDone;

  return (
    <aside className="flex min-h-0 flex-col border-l-2 border-ink bg-white">
      <PanelHead title="Heat pain">
        {rows.length ? (
          <>
            <b>{inr(top.reduce((sum, row) => sum + (row.walkersPerDay || 0), 0))} people a day</b> walk the {top.length} worst stretches in {placeName}.{" "}
            <b>
              {top.filter((row) => row.sunShare >= HOT_SHARE).length} of {top.length}
            </b>{" "}
            are in direct sun 90%+ of the time, {when}.
          </>
        ) : (
          `The paths in ${placeName} with the most people in full sun.`
        )}
      </PanelHead>

      <div className="flex border-b border-line">
        <MonthPicker month={month} onMonth={setMonth} disabled={byHour} className="flex-1 border-r border-line" />
        <div className="flex min-h-[62px] flex-[1.4] flex-col justify-center border-r border-line px-4 py-2.5 text-[12.5px] text-muted">
          Hours
          <span className="mt-0.5 flex gap-1.5">
            {[
              [false, "10 AM – 4 PM"],
              [true, "By hour"],
            ].map(([value, label]: any) => (
              <button
                key={label}
                type="button"
                aria-pressed={byHour === value}
                onClick={() => chooseByHour(value)}
                className={`px-2.5 py-1 text-[13.5px] font-bold shadow-[inset_0_0_0_1.5px_var(--color-ink)] ${byHour === value ? "bg-ink text-white" : "text-ink"}`}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        <button
          type="button"
          disabled={!rows.length}
          onClick={() => downloadCsv(rows, `sunskip-heat-pain-${area.key}-${byHour ? `may-${hour}h` : MONTHS[month - 1].toLowerCase()}.csv`)}
          className="flex min-h-[62px] flex-1 flex-col justify-center px-4 py-2.5 text-left text-[12.5px] text-muted transition-colors hover:bg-hover disabled:opacity-40"
        >
          Export
          <b className="flex items-center gap-1.5 text-[15px] text-ink">
            CSV <DownloadSimple size={16} weight="bold" />
          </b>
        </button>
      </div>

      {byHour && (
        <div className="flex items-center gap-4 border-b border-line bg-hover px-6.5 py-3">
          <span className="num min-w-[76px] text-[30px] leading-none">{hourLabel(hour)}</span>
          <div className="flex flex-1 flex-col">
            <input type="range" min={FIRST_HOUR} max={LAST_HOUR} step={1} value={hour} onChange={(event) => setHour(Number(event.target.value))} aria-label="Hour of the day in May" className="w-full accent-ink" />
            <span className="flex justify-between text-[11px] text-muted">
              <span>7 AM</span>
              <span>10</span>
              <span>1 PM</span>
              <span>4</span>
              <span>6 PM</span>
            </span>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {waitingJob && (
          <StateMessage
            icon={<HourglassMedium size={40} weight="bold" />}
            title="Getting this area ready"
            text="Shade data for this area is being fetched. The first time takes a few minutes; after that it opens at once."
          >
            {cellsTotal ? (
              <>
                <Meter done={cellsDone} total={cellsTotal} className="w-full max-w-[340px]" />
                <p className="text-muted">
                  {cellsDone} of {cellsTotal} ready
                </p>
              </>
            ) : null}
          </StateMessage>
        )}
        {error && !waitingJob && (
          <StateMessage icon={<WifiSlash size={40} weight="bold" />} title="Can't reach SunSkip" text={`${error}. Check your connection and try again. Your area and filters are kept.`}>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex min-h-[46px] items-center gap-2 bg-ink px-5 font-bold text-white hover:bg-[#2E2723]">
              <ArrowsClockwise size={18} weight="bold" />
              Try again
            </button>
          </StateMessage>
        )}
        {busy && !error && !waitingJob && <SkeletonRows />}
        {data && !error && !waitingJob && (
          <>
            {data.shade.status === "PREPARING" && (
              <div className="flex gap-3 border-b border-line bg-shade-tint px-6.5 py-3.5 text-[14px] leading-snug">
                <HourglassMedium size={20} weight="bold" className="mt-px flex-none text-shade-text" />
                <div className="flex-1">
                  <b className="block">Part of this area is still being prepared</b>
                  {cellsTotal ? `${cellsDone} of ${cellsTotal} map areas ready. ` : ""}The list uses the paths that are ready and updates by itself.
                  {cellsTotal ? <Meter done={cellsDone} total={cellsTotal} className="mt-2" /> : null}
                </div>
              </div>
            )}
            {rows.length ? (
              <PainList rows={rows} hover={hover} onHover={setHover} onOpen={open} />
            ) : (
              <StateMessage
                icon={<MapTrifold size={40} weight="bold" />}
                title="No busy paths here yet"
                text="No stretch in this area has people-a-day estimates yet. They come from the nightly demand job, or as people plan trips here."
              />
            )}
          </>
        )}
      </div>

      {/* Sits over the map: the panel has no position of its own, so this is placed in <main> */}
      <div className="absolute top-5 left-5 z-[3] flex border-2 border-ink bg-white text-[12px] font-bold">
        {BANDS.slice(0, 4).map((band) => (
          <span key={band.key} className="flex items-center gap-1.5 px-3 py-2 not-first:border-l not-first:border-line">
            <i className="size-3.5" style={{ background: band.color }} />
            {band.legend}
          </span>
        ))}
      </div>
    </aside>
  );
}
