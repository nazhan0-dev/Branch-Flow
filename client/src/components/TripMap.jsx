import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'

// marker ทำจาก divIcon (ไม่ต้องใช้ไฟล์รูปของ Leaflet)
const circle = (bg, label = '', size = 28, ring) =>
    L.divIcon({
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${bg};color:#fff;display:grid;place-items:center;font:700 12px 'IBM Plex Sans Thai',sans-serif;border:3px solid #fff;box-shadow:0 ${ring ? `0 0 8px ${ring}` : '2px 6px rgba(0,0,0,.25)'}">${label}</div>`,
    })
const square = (bg, svg, size = 36) =>
    L.divIcon({
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div style="width:${size}px;height:${size}px;border-radius:10px;background:${bg};display:grid;place-items:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">${svg}</div>`,
    })
const HOUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 3 2 11h3v9h14v-9h3z"/></svg>'
const TRUCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M2 6h12v9H2zM14 9h4l3 3v3h-7z"/><circle cx="6" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>'

const ICON = {
    origin: square('#141614', HOUSE),
    truck: circle('#22a45d', TRUCK, 38, 'rgba(34,164,93,.25)'),
    truckDark: circle('#141614', TRUCK, 32),
    stop: (seq, status, urgent) => circle(status === 'received' ? '#9aa097' : status === 'arrived' ? '#f5a524' : urgent ? '#e5484d' : '#141614', seq, 28),
    branch: { out: circle('#e5484d', '', 18, 'rgba(229,72,77,.3)'), low: circle('#f5a524', '', 18, 'rgba(245,165,36,.3)'), ok: circle('#fff', '', 16) },
}
const OK_BORDER = L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div style="width:16px;height:16px;border-radius:999px;background:#fff;border:3px solid #9aa097"></div>' })

// ขอเส้นทางถนนจริงจาก OSRM ถ้าไม่สำเร็จใช้เส้นตรงแทน
export const useRoute = (points) => {
    const key = points.map((p) => p.join(',')).join(';')
    const [route, setRoute] = useState({ line: null, km: null, minutes: null })
    useEffect(() => {
        if (points.length < 2) return setRoute({ line: null, km: null, minutes: null })
        const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(';')
        const ctrl = new AbortController()
        fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`, { signal: ctrl.signal })
            .then((r) => r.json())
            .then((j) => {
                const r = j.routes?.[0]
                setRoute(r ? { line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), km: r.distance / 1000, minutes: Math.round(r.duration / 60) } : { line: null, km: null, minutes: null })
            })
            .catch(() => setRoute({ line: null, km: null, minutes: null }))
        return () => ctrl.abort()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])
    return { ...route, line: route.line || points }
}

// ซูมออกได้สุดแค่ระดับประเทศ ไม่ให้หลุดไปเห็นทั้งโลก
const MIN_ZOOM = 4

// ล้อเมาส์ซูมแผนที่ได้หลังคลิกแผนที่เท่านั้น เมาส์ออกนอกแผนที่ก็ปิด
// ไม่อย่างนั้นผู้ใช้เลื่อนหน้าลงแล้วเมาส์บังเอิญอยู่บนแผนที่ แผนที่จะซูมออกแทนการเลื่อนหน้า
const WheelZoomOnClick = () => {
    const map = useMap()
    useEffect(() => {
        const on = () => map.scrollWheelZoom.enable()
        const off = () => map.scrollWheelZoom.disable()
        map.on('click', on)
        map.on('mouseout', off)
        return () => {
            map.off('click', on)
            map.off('mouseout', off)
        }
    }, [map])
    return null
}

const FitBounds = ({ points, pad }) => {
    const map = useMap()
    const key = points.map((p) => p.join(',')).join(';')
    useEffect(() => {
        // ไม่ใช้ animation: ถ้าแผนที่ถูกปิดระหว่างเลื่อน Leaflet จะ error
        const opts = pad ? { paddingTopLeft: [40, pad[0]], paddingBottomRight: [40, pad[1]] } : { padding: [50, 50] }
        if (points.length === 1 && !pad) map.setView(points[0], 14, { animate: false })
        else if (points.length) map.fitBounds(points.length === 1 ? [points[0], points[0]] : points, { ...opts, maxZoom: 14, animate: false })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, map, pad?.[0], pad?.[1]]) // pad เปลี่ยน (เช่นพับแผ่นข้อมูลลง) → จัดมุมมองใหม่ให้อยู่ในส่วนที่มองเห็น
    return null
}

/**
 * trip       = ผลจาก GET /trips/:id (origin, stops, lastLocation) หรือรูปแบบเดียวกัน
 * truck      = ตำแหน่งล่าสุดแบบ real-time { lat, lng }
 * trucks     = รถคันอื่นบนแผนที่รวม [{ tripId, lat, lng, code, driverName, active }]
 * branches   = สาขาทั้งหมดพร้อมสถานะสต็อก (แผนที่ Admin)
 * labels     = แสดงชื่อสาขาใต้หมุด
 */
export default function TripMap({ trip, truck, trucks = [], branches = [], labels, className = 'h-[420px]', rounded = 'rounded-[22px]', zoomControl = true, onRoute, fitPad, children }) {
    const stops = useMemo(() => trip?.stops || [], [trip])
    const origin = trip?.origin
    const pts = useMemo(() => {
        const list = []
        if (origin) list.push([Number(origin.lat), Number(origin.lng)])
        for (const s of stops) list.push([Number(s.lat), Number(s.lng)])
        return list
    }, [origin, stops])
    const route = useRoute(pts)
    useEffect(() => {
        onRoute?.(route)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.km, route.minutes])

    // เที่ยวจบแล้วไม่ต้องแสดงรถ (ไม่อย่างนั้นจะค้างที่พิกัดสุดท้ายบนแผนที่)
    const finished = ['completed', 'cancelled'].includes(trip?.status)
    const pos = finished ? null : truck || trip?.lastLocation
    const truckPos = pos?.lat != null ? [Number(pos.lat), Number(pos.lng)] : null
    const fit = pts.length ? pts : branches.length ? branches.map((b) => [Number(b.lat), Number(b.lng)]) : trucks.map((t) => [Number(t.lat), Number(t.lng)])
    const stopBranchIds = new Set(stops.map((s) => s.branchId))

    return (
        <div className={`relative overflow-hidden ${rounded} ${className}`}>
            <MapContainer center={[13.82, 100.62]} zoom={11} minZoom={MIN_ZOOM} className="h-full w-full" scrollWheelZoom={false} zoomControl={false}>
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FitBounds points={fit} pad={fitPad} />
                <WheelZoomOnClick />
                {zoomControl && <ZoomButtons />}
                {branches
                    .filter((b) => !b.isWarehouse && !stopBranchIds.has(b.id))
                    .map((b) => (
                        <Marker key={`b${b.id}`} position={[Number(b.lat), Number(b.lng)]} icon={b.outItems > 0 ? ICON.branch.out : b.lowItems > 0 ? ICON.branch.low : OK_BORDER}>
                            <Tooltip direction="bottom" offset={[0, 10]} permanent={labels} className="bl-label">{b.name}</Tooltip>
                        </Marker>
                    ))}
                {branches.filter((b) => b.isWarehouse && !origin).map((b) => (
                    <Marker key={`w${b.id}`} position={[Number(b.lat), Number(b.lng)]} icon={ICON.origin}>
                        <Tooltip direction="bottom" offset={[0, 18]} permanent={labels} className="bl-label">{b.name}</Tooltip>
                    </Marker>
                ))}
                {pts.length > 1 && <Polyline positions={route.line} pathOptions={{ color: trip?.status === 'on_route' || !trip?.status ? '#22a45d' : '#141614', weight: 5, opacity: 0.9 }} />}
                {origin && (
                    <Marker position={[Number(origin.lat), Number(origin.lng)]} icon={ICON.origin}>
                        <Tooltip direction="bottom" offset={[0, 18]} permanent={labels} className="bl-label">{origin.name}</Tooltip>
                    </Marker>
                )}
                {stops.map((s) => (
                    <Marker key={s.id} position={[Number(s.lat), Number(s.lng)]} icon={ICON.stop(s.seq, s.status, s.priority === 'urgent')}>
                        <Tooltip direction="bottom" offset={[0, 14]} permanent={labels} className="bl-label">{s.branchName || s.label}</Tooltip>
                    </Marker>
                ))}
                {truckPos && (
                    <Marker position={truckPos} icon={ICON.truck}>
                        <Popup>{trip?.code}</Popup>
                    </Marker>
                )}
                {trucks.map((t) => (
                    <Marker key={t.tripId} position={[Number(t.lat), Number(t.lng)]} icon={t.active ? ICON.truck : ICON.truckDark}>
                        <Popup>{t.code} · {t.driverName}</Popup>
                    </Marker>
                ))}
            </MapContainer>
            {children}
        </div>
    )
}

// ปุ่มซูมสไตล์เดียวกับดีไซน์ (กล่องขาวมุมโค้ง มุมขวาล่าง)
const ZoomButtons = () => {
    const map = useMap()
    return (
        <div className="absolute right-4 bottom-4 z-[500] flex flex-col gap-2">
            {[
                ['+', () => map.zoomIn()],
                ['−', () => map.zoomOut()],
            ].map(([t, fn]) => (
                <button key={t} type="button" onClick={fn} className="grid size-10 place-items-center rounded-xl bg-white text-lg shadow-sm">{t}</button>
            ))}
        </div>
    )
}
