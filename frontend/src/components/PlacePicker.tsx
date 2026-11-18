import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LoaderCircle, MapPin, Search, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { SAVED_PLACES } from "../lib/places";
import { Button, cx, fieldControl } from "./ui";

/** A point on the map as sent to the API ({ latitude, longitude, label }). */
export interface PlacePoint {
  latitude: number;
  longitude: number;
  label: string;
}

interface Place extends PlacePoint {
  name: string;
  detail: string;
  kind: string;
}

type Which = "from" | "to";
const TITLE: Record<Which, string> = { from: "نقطة الانطلاق", to: "الوجهة" };
const CAIRO: L.LatLngTuple = [30.0444, 31.2357];
// Egypt with some margin: the map can't wander off to the other side of the world.
const EGYPT_BOUNDS = L.latLngBounds([20.5, 23.5], [33.0, 38.0]);

/** Teardrop pin coloured by the theme (start = navy, destination = accent). */
const pinIcon = (which: Which, faded = false) =>
  L.divIcon({
    className: "",
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    html: `<div class="${which === "from" ? "text-navy" : "text-gold"}" style="opacity:${faded ? 0.45 : 1}">
      <svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 1C8.7 1 2 7.6 2 15.8 2 27 17 43 17 43s15-16 15-27.2C32 7.6 25.3 1 17 1z" fill="currentColor" stroke="white" stroke-width="2"/>
      <text x="17" y="20" text-anchor="middle" font-size="12" font-weight="700" fill="white" font-family="Cairo, sans-serif">${which === "from" ? "من" : "إلى"}</text></svg></div>`,
  });

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The "من" / "إلى" field on the booking form: shows the chosen place and opens the map. */
export function LocationField({ which, value, other, onChange }: { which: Which; value: PlacePoint | null; other?: PlacePoint | null; onChange: (p: PlacePoint) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-raised px-3 py-2.5 text-right transition hover:border-gold/60 focus-visible:border-gold/60 focus-visible:outline-none"
        aria-label={`${which === "from" ? "من" : "إلى"}: ${value?.label ?? "اختار على الخريطة"}`}
      >
        <span className="text-[12px] text-muted">{which === "from" ? "من" : "إلى"}</span>
        <span className="flex items-center gap-2">
          <MapPin className={cx("size-4 shrink-0", which === "from" ? "text-navy dark:text-gold" : "text-gold")} />
          {value ? (
            <span className="min-w-0 truncate text-[15px] font-bold text-cream">{value.label}</span>
          ) : (
            <span className="text-[15px] text-muted/80">{which === "from" ? "حدد نقطة الانطلاق على الخريطة" : "حدد الوجهة على الخريطة"}</span>
          )}
        </span>
      </button>
      {open && (
        <PlacePickerDialog
          which={which}
          initial={value}
          other={other ?? null}
          onClose={() => setOpen(false)}
          onPick={(p) => {
            onChange(p);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/**
 * Search anywhere in Egypt (OpenStreetMap, through the API), or click / drag
 * the pin; the address at the pin fills in by itself and can be edited (e.g.
 * "البوابة 2"). The other point of the trip is shown faded for context.
 */
export function PlacePickerDialog({
  which,
  initial,
  other,
  onClose,
  onPick,
}: {
  which: Which;
  initial: PlacePoint | null;
  other: PlacePoint | null;
  onClose: () => void;
  onPick: (p: PlacePoint) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const [pin, setPin] = useState<PlacePoint | null>(initial);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [looking, setLooking] = useState(false);
  const [center, setCenter] = useState<{ lat: number; lng: number }>(() =>
    initial ? { lat: initial.latitude, lng: initial.longitude } : other ? { lat: other.latitude, lng: other.longitude } : { lat: CAIRO[0], lng: CAIRO[1] }
  );
  const [text, setText] = useState("");
  const [showResults, setShowResults] = useState(false);
  const q = useDebounced(text.trim());
  const lookup = useRef(0);

  const search = useQuery({
    queryKey: ["places", q, center.lat.toFixed(2), center.lng.toFixed(2)],
    queryFn: () => api.get<Place[]>(`/places/search?q=${encodeURIComponent(q)}&lat=${center.lat}&lng=${center.lng}`),
    enabled: q.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

  /** Put the pin somewhere. With a known name (search result, saved place) no lookup is needed. */
  const place = (lat: number, lng: number, known?: string, zoom?: number) => {
    const m = map.current;
    if (!m) return;
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { icon: pinIcon(which), draggable: true, keyboard: true, title: TITLE[which] }).addTo(m);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLatLng();
        place(p.lat, p.lng);
      });
    } else marker.current.setLatLng([lat, lng]);
    if (zoom) m.flyTo([lat, lng], zoom, { duration: 0.6 });
    const ticket = ++lookup.current;
    setPin({ latitude: lat, longitude: lng, label: known ?? "" });
    if (known) {
      setLabel(known);
      setLooking(false);
      return;
    }
    setLooking(true);
    api
      .get<Place>(`/places/reverse?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`)
      .then((p) => {
        if (ticket === lookup.current) setLabel(p.label);
      })
      .catch(() => {
        if (ticket === lookup.current) setLabel(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      })
      .finally(() => {
        if (ticket === lookup.current) setLooking(false);
      });
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  useEffect(() => {
    dialog.current?.showModal();
    const m = L.map(mapEl.current!, {
      center: [center.lat, center.lng],
      zoom: initial || other ? 14 : 11,
      minZoom: 5,
      maxBounds: EGYPT_BOUNDS,
      maxBoundsViscosity: 0.8,
      attributionControl: true,
    });
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>');
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // OSM's tile policy needs a Referer; send the site's origin only.
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(m);
    if (other) L.marker([other.latitude, other.longitude], { icon: pinIcon(which === "from" ? "to" : "from", true), interactive: false }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => placeRef.current(e.latlng.lat, e.latlng.lng));
    m.on("moveend", () => {
      const c = m.getCenter();
      setCenter({ lat: c.lat, lng: c.lng });
    });
    map.current = m;
    if (initial) placeRef.current(initial.latitude, initial.longitude, initial.label);
    // The dialog lays out after showModal; Leaflet needs the final size.
    const t = setTimeout(() => m.invalidateSize(), 60);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const results = search.data ?? [];
  const canConfirm = Boolean(pin && label.trim() && !looking);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      className="m-auto w-[min(880px,calc(100vw-1.5rem))] rounded-[18px] border border-line bg-surface p-0 text-cream backdrop:bg-ink/70 backdrop:backdrop-blur-sm"
      aria-label={TITLE[which]}
    >
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[18px] font-bold">{TITLE[which]}</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="text-muted hover:text-cream" aria-label="إغلاق">
            <X className="size-5" />
          </button>
        </div>

        <div className="relative">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2.5 focus-within:border-gold/60">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = results[0];
                  if (first) {
                    placeRef.current(first.latitude, first.longitude, first.label, 17);
                    setShowResults(false);
                  }
                }
                if (e.key === "Escape" && showResults) {
                  e.preventDefault();
                  setShowResults(false);
                }
              }}
              placeholder="ابحث عن مكان: قاعة، فندق، شارع، منطقة…"
              className="w-full bg-transparent text-[14px] text-cream outline-none placeholder:text-muted/70"
              aria-label="ابحث عن مكان"
              autoFocus
            />
            {search.isFetching && <LoaderCircle className="size-4 shrink-0 animate-spin text-muted" aria-hidden />}
          </label>
          {showResults && q.length >= 2 && !search.isFetching && (
            <ul className="absolute inset-x-0 top-full z-[1000] mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl" role="listbox" aria-label="نتايج البحث">
              {search.error ? (
                <li className="px-3 py-2.5 text-[13px] text-rose">
                  {search.error instanceof ApiError && search.error.status === 502 ? "البحث مش متاح دلوقتي. حط الدبوس على الخريطة بإيدك." : "مش قادر أبحث دلوقتي."}
                </li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2.5 text-[13px] text-muted">مفيش نتايج. جرّب اسم تاني أو حط الدبوس على الخريطة.</li>
              ) : (
                results.map((r) => (
                  <li key={`${r.latitude},${r.longitude},${r.label}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        placeRef.current(r.latitude, r.longitude, r.label, 17);
                        setShowResults(false);
                      }}
                      className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-right hover:bg-raised"
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-bold text-cream">{r.name}</span>
                        {r.detail && <span className="block truncate text-[12px] text-muted">{r.detail}</span>}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" aria-label="أماكن محفوظة">
          {SAVED_PLACES.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => placeRef.current(p.latitude, p.longitude, p.label, 16)}
              className="rounded-full border border-line bg-raised px-3 py-1 text-[12px] text-muted transition hover:border-gold/60 hover:text-cream"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div dir="ltr" className="relative isolate overflow-hidden rounded-xl border border-line">
          <div ref={mapEl} className="map-surface h-[300px] w-full sm:h-[380px]" role="application" aria-label="الخريطة: دوس على أي مكان عشان تحط الدبوس" />
          {!pin && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-[500] flex justify-center">
              <span className="rounded-full bg-ink/80 px-3 py-1 text-[12px] text-white" dir="rtl">دوس على أي مكان في الخريطة عشان تحط الدبوس</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border border-line bg-raised px-3 pb-2.5 pt-2.5 focus-within:border-gold/60">
            <span className="flex items-center justify-between text-[12px] text-muted">
              <span>اسم المكان زي ما هيظهر للسواق والعميل</span>
              {pin && <span className="ltr">{pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}</span>}
            </span>
            <input
              className={fieldControl}
              value={looking ? "" : label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={looking ? "بيجيب العنوان…" : pin ? "اكتب اسم للمكان" : "حط الدبوس الأول"}
              disabled={!pin || looking}
              maxLength={200}
              aria-label="اسم المكان"
            />
          </label>
          <Button
            variant="primary"
            size="lg"
            disabled={!canConfirm}
            onClick={() => {
              if (!pin) return;
              onPick({ latitude: Number(pin.latitude.toFixed(6)), longitude: Number(pin.longitude.toFixed(6)), label: label.trim() });
              dialog.current?.close();
            }}
          >
            تأكيد المكان
          </Button>
        </div>
      </div>
    </dialog>
  );
}
