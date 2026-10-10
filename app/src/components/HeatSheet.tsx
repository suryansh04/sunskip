import { useEffect, useState } from "react";
import { Warning, Wind } from "@phosphor-icons/react";
import { api } from "../api/client";
import { atHour, dayLabel, errorMessage, fmt, hourOf, shortTime } from "../format";
import Sheet from "./Sheet";
import Button from "./Button";

const FIRST_HOUR = 7;
const HOURS_SHOWN = 13; // 7 AM to 7 PM
const BAR_FROM_C = 24;
const BAR_PX_PER_C = 3.2;
const MIN_BAR_PX = 6;

// Heat details (screen 05): feels-like now, the day's feels-like bars and air quality
export default function HeatSheet({ place, placeName, at, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError("");
    const conditionsAt = (time) => api.get("/conditions", { params: { lat: place.lat, lng: place.lng, at: time } });
    // /conditions gives the 24 hours from `at`, so the day's bars need a second call from 7 AM
    Promise.all([api.get("/meta"), conditionsAt(at), conditionsAt(atHour(at, FIRST_HOUR))])
      .then(([meta, current, day]) => setData({ alertFromC: meta.data.heatAlertFeelsLikeC, now: current.data, hours: day.data.hourly.slice(0, HOURS_SHOWN) }))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [attempt]);

  return (
    <Sheet label="Heat details" className="px-5 pt-1.5 pb-[calc(18px+env(safe-area-inset-bottom))]" onClose={onClose}>
      {loading && (
        <div className="mt-4 grid gap-3" aria-label="Loading the heat details">
          <i className="shimmer block h-4 w-1/2 rounded-md" />
          <i className="shimmer block h-14 w-2/5 rounded-md" />
          <i className="shimmer block h-28 rounded-md" />
          <p className="text-[14px] text-muted">Loading the weather for today…</p>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <b className="block text-[17px] font-[650]">Can't load the weather</b>
          <p className="mt-1 text-[15px] text-muted">{error}. Check your connection and try again.</p>
          <Button className="mt-4" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </div>
      )}
      {data && !loading && (
        <>
          <div className="mt-2.5 flex items-start justify-between gap-3">
            <div>
              <small className="block text-[14px] text-muted">{`${placeName} · ${dayLabel(at)}, ${shortTime(at)}`}</small>
              {data.now.feelsLikeC === null ? (
                <b className="mt-1 block text-[22px] font-[650] text-muted">unknown</b>
              ) : (
                <b className="wide mt-1 block text-[56px] leading-none font-[760]">{`${Math.round(data.now.feelsLikeC)}°C`}</b>
              )}
              <span className="text-[15px] text-muted">{`feels like · air ${data.now.tempC === null ? "temperature unknown" : fmt(data.now.tempC) + "°C"}`}</span>
            </div>
            {data.now.heatAlert && (
              <span className="inline-flex items-center gap-1.5 rounded-[10px] bg-alert px-3 py-2 text-[15px] font-bold whitespace-nowrap text-white">
                <Warning size={18} weight="bold" />
                Heat alert
              </span>
            )}
          </div>
          <p className="mt-3 text-[15px]">
            {data.now.heatAlert
              ? `It feels like ${data.alertFromC} °C or more. Leaving later, or taking a route with less walking in the sun, cuts your time in direct sun.`
              : `No heat alert right now. The alert starts when it feels like ${data.alertFromC} °C or more.`}
          </p>
          {(data.now.typical || data.now.stale) && (
            <p className="mt-1 text-[14px] text-muted">{data.now.typical ? "Typical weather for this date, not a forecast." : "The weather service is not answering. These are the last numbers we got."}</p>
          )}

          <h2 className="mt-[18px] text-[16px] leading-[1.3] font-[650]">Feels like, through the day</h2>
          <div className="mt-2 grid h-[118px] items-end gap-[3px]" style={{ gridTemplateColumns: `repeat(${data.hours.length}, 1fr)` }}>
            {data.hours.map((hour) => {
              const isNow = hourOf(hour.at) === hourOf(at);
              const known = hour.feelsLikeC !== null;
              return (
                <span key={hour.at} className="flex h-full flex-col items-center justify-end gap-1">
                  <span className="text-[13px] font-[650]">{known ? Math.round(hour.feelsLikeC) : "?"}</span>
                  <i
                    className={`w-full max-w-4 rounded ${!known ? "bg-unknown" : hour.feelsLikeC >= data.alertFromC ? "bg-alert" : "bg-sun"}`}
                    style={{ height: known ? Math.max(MIN_BAR_PX, (hour.feelsLikeC - BAR_FROM_C) * BAR_PX_PER_C) : MIN_BAR_PX }}
                  />
                  <span className={`text-[13px] ${isNow ? "font-bold text-ink" : "text-muted"}`}>{hourOf(hour.at) % 12 || 12}</span>
                </span>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3.5 text-[15px]">
            <span className="inline-flex items-center gap-2">
              <Wind size={20} weight="bold" />
              Air quality (NAQI)
            </span>
            <b className="text-right font-[650]">{data.now.naqi === null ? "Unknown for this date" : `${data.now.naqi} · ${data.now.naqiCategory}`}</b>
          </div>
          <p className="mt-2.5 mb-3.5 text-[13px] text-muted">Weather from Open-Meteo. Air quality from Google, for the next few days only.</p>
          <Button ghost onClick={onClose}>
            Close
          </Button>
        </>
      )}
    </Sheet>
  );
}
