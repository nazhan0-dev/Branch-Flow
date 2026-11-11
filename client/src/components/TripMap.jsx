import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'

// ชื่อใต้หมุด วาดในตัวหมุดเอง (ช่อง tooltip ของ Leaflet มีได้ช่องเดียว ใช้กับข้อความตอนชี้เมาส์แทน)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const stopLabel = (label) => (label ? `<span class="bl-stop-label">${esc(label)}</span>` : '')

// marker ทำจาก divIcon (ไม่ต้องใช้ไฟล์รูปของ Leaflet)
const circle = (bg, inner = '', size = 28, ring, label, border = '#fff') =>
    L.divIcon({
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:999px;background:${bg};color:#fff;display:grid;place-items:center;font:700 12px 'IBM Plex Sans Thai',sans-serif;border:3px solid ${border};box-shadow:0 ${ring ? `0 0 8px ${ring}` : '2px 6px rgba(0,0,0,.25)'}">${inner}${stopLabel(label)}</div>`,
    })
// หมุดคลังกลาง: หมุดปักทรงหยดน้ำ พื้นดำ ขอบขาว ไอคอนโกดังสีขาว ปลายหมุดชี้ตำแหน่งคลังพอดี
const warehousePin = (label) =>
    L.divIcon({
        className: '',
        iconSize: [40, 50],
        iconAnchor: [20, 48],
        html: `<div style="position:relative;width:40px;height:50px"><svg width="40" height="50" viewBox="0 0 40 50" style="filter:drop-shadow(0 3px 4px rgba(20,22,20,.28));overflow:visible">
        <path d="M20 48C20 48 4 31.5 4 19.5a16 16 0 1 1 32 0C36 31.5 20 48 20 48Z" fill="#141614" stroke="#fff" stroke-width="2.5"/>
        <g transform="translate(10.5 9.5) scale(0.79)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/>
            <path d="M6 18h12M6 14h12"/><rect width="12" height="12" x="6" y="10"/>
        </g>
    </svg>${stopLabel(label)}</div>`,
    })
// ไอคอนรถบรรทุกแบบเส้น (ชุดเดียวกับไอคอนเมนู lucide)
const TRUCK = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>'
// หมุดรถ: วงกลมขอบขาว เงาเทาบาง ๆ · live = มีวงแหวนเขียวกระจายเป็นจังหวะ (รถกำลังวิ่ง ส่งตำแหน่งสด)
const truckIcon = (bg, live) =>
    L.divIcon({
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        html: `<div style="position:relative;width:36px;height:36px">${live ? '<span class="bl-truck-pulse"></span>' : ''}<div style="position:relative;width:36px;height:36px;border-radius:999px;background:${bg};display:grid;place-items:center;border:3px solid #fff;box-shadow:0 0 0 1px rgba(20,22,20,.08),0 4px 10px rgba(20,22,20,.25)">${TRUCK}</div></div>`,
    })

/**
 * ความหมายของสีบนแผนที่ (ต้องตรงกับคำอธิบายสีในหน้าแผนที่ติดตามรถ)
 *  เที่ยวส่ง:  เขียว = กำลังส่ง · ดำ = รอออกรถ · เทา = ส่งครบ/รับของแล้ว
 *  สต็อกสาขา: ส้ม = ใกล้หมด · แดง = หมด  (ใช้กับหมุดสาขาเท่านั้น ไม่ใช้กับจุดส่ง)
 */
export const MAP_COLORS = { onRoute: '#22a45d', waiting: '#141614', done: '#9aa097', low: '#f5a524', out: '#e5484d' }

// จุดส่ง (วงกลมมีเลขลำดับ)
//  - ยังไม่ถึง: ดำ · รถถึงแล้ว (รอสาขารับ): ดำขอบเขียว + ถูกเล็กที่มุม
//  - สาขารับของแล้ว (เสร็จ): วงขาวขอบเทา + ถูกสีเขียวตรงกลาง
//  - คำขอด่วน: ป้าย "ด่วน" เล็ก ๆ ข้างหมุด (ไม่ใช้พื้นแดง เพราะแดง = สาขาของหมด)
const CHECK = (size, color, width) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
const stopIcon = (seq, status, urgent, label) => {
    if (status === 'received') {
        return L.divIcon({
            className: '',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            html: `<div aria-label="จุดที่ ${seq} รับของแล้ว" style="position:relative;width:28px;height:28px;border-radius:999px;background:#fff;display:grid;place-items:center;border:3px solid ${MAP_COLORS.done};box-shadow:0 2px 6px rgba(0,0,0,.2)">${CHECK(15, MAP_COLORS.onRoute, 3.5)}${stopLabel(label)}</div>`,
        })
    }
    const bg = MAP_COLORS.waiting
    const border = status === 'arrived' ? MAP_COLORS.onRoute : '#fff'
    const check = status === 'arrived'
        ? `<span style="position:absolute;right:-5px;bottom:-5px;width:15px;height:15px;border-radius:999px;background:${MAP_COLORS.onRoute};border:2px solid #fff;display:grid;place-items:center">${CHECK(8, '#fff', 4)}</span>`
        : ''
    const badge = urgent
        ?`<span style="position:absolute;left:calc(100% - 4px);top:-9px;padding:1px 6px;border-radius:8px;background:#fde8e6;color:#c8382c;font:700 10px/1.4 'IBM Plex Sans Thai',sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.15)">ด่วน</span>`
        : ''
    return L.divIcon({
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `<div style="position:relative;width:28px;height:28px;border-radius:999px;background:${bg};color:#fff;display:grid;place-items:center;font:700 12px 'IBM Plex Sans Thai',sans-serif;border:3px solid ${border};box-shadow:0 2px 6px rgba(0,0,0,.25)">${seq}${check}${badge}${stopLabel(label)}</div>`,
    })
}

const ICON = {
    origin: warehousePin,
    truck: truckIcon(MAP_COLORS.onRoute, true),
    truckDark: truckIcon(MAP_COLORS.waiting, false),
    stop: stopIcon,
    // หมุดสาขา: แดง = หมด · ส้ม = ใกล้หมด · ขาวขอบเทา = ปกติ
    branch: (b, label) =>
        b.outItems > 0 ? circle(MAP_COLORS.out, '', 18, 'rgba(229,72,77,.3)', label)
            : b.lowItems > 0 ? circle(MAP_COLORS.low, '', 18, 'rgba(245,165,36,.3)', label)
                : circle('#fff', '', 16, null, label, MAP_COLORS.done),
}
// สีเส้นทางตามสถานะเที่ยว: กำลังส่ง/หน้าวางแผน = เขียว · ยังไม่ออกรถ = ดำ · ส่งครบ/ยกเลิก = เทา
const routeStyle = (status) => {
    if (status === 'completed' || status === 'cancelled') return { color: MAP_COLORS.done, opacity: 0.9 }
    if (status === 'assigned' || status === 'accepted') return { color: MAP_COLORS.waiting, opacity: 0.9 }
    return { color: MAP_COLORS.onRoute, opacity: 0.95 }
}

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
 * พาแผนที่ไปยังผลค้นหา (เล่นเมื่อ focus.key เปลี่ยน)
 *  - { lat, lng, key }  → บินไปที่จุดนั้น แล้วเปิดข้อความของหมุดตรงนั้น
 *  - { key }            → เลื่อน/ซูมให้เห็นเส้นทางของเที่ยวที่แสดงอยู่ทั้งเส้น
 */
const FocusOn = ({ focus, points, pad }) => {
    const map = useMap()
    useEffect(() => {
        if (!focus) return
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        const anim = { animate: !reduce, duration: reduce ? 0 : 0.9 }
        const opts = pad ? { paddingTopLeft: [40, pad[0]], paddingBottomRight: [40, pad[1]] } : { padding: [50, 50] }
        try {
            if (focus.lat != null) {
                const ll = L.latLng(Number(focus.lat), Number(focus.lng))
                const openTip = () => map.eachLayer((l) => l instanceof L.Marker && l.getLatLng().equals(ll) && l.getTooltip() && l.openTooltip())
                map.once('moveend', openTip)
                map.flyTo(ll, Math.max(map.getZoom(), 13), anim)
            } else if (points.length) {
                map.flyToBounds(points, { ...opts, maxZoom: 14, ...anim })
            }
        } catch {
            // แผนที่ถูกปิดระหว่างเลื่อน: ไม่ต้องทำอะไร
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus?.key])
    return null
}

/**
 * trip       = ผลจาก GET /trips/:id (origin, stops, lastLocation) หรือรูปแบบเดียวกัน
 * truck      = ตำแหน่งล่าสุดแบบ real-time { lat, lng }
 * trucks     = รถคันอื่นบนแผนที่รวม [{ tripId, lat, lng, code, driverName, active }]
 * branches   = สาขาทั้งหมดพร้อมสถานะสต็อก (แผนที่ Admin)
 * labels     = แสดงชื่อสาขาใต้หมุด
 * focus      = พาแผนที่ไปยังผลค้นหา (ดู FocusOn)
 */
export default function TripMap({ trip, truck, trucks = [], branches = [], labels, className = 'h-[420px]', rounded = 'rounded-[22px]', zoomControl = true, onRoute, fitPad, focus, children }) {
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
        <div className={`bl-map relative overflow-hidden ${rounded} ${className}`}>
            <MapContainer center={[13.82, 100.62]} zoom={11} minZoom={MIN_ZOOM} className="h-full w-full" scrollWheelZoom={false} zoomControl={false}>
                <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <FitBounds points={fit} pad={fitPad} />
                <FocusOn focus={focus} points={route.line?.length > 1 ? route.line : pts} pad={fitPad} />
                <WheelZoomOnClick />
                {zoomControl && <ZoomButtons />}
                {branches
                    .filter((b) => !b.isWarehouse && !stopBranchIds.has(b.id))
                    .map((b) => (
                        <Marker key={`b${b.id}`} position={[Number(b.lat), Number(b.lng)]} icon={ICON.branch(b, labels ? b.name : null)}>
                            <HoverTip offset={-10}><BranchInfo b={b} /></HoverTip>
                        </Marker>
                    ))}
                {branches.filter((b) => b.isWarehouse && !origin).map((b) => (
                    <Marker key={`w${b.id}`} position={[Number(b.lat), Number(b.lng)]} icon={ICON.origin(labels ? b.name : null)} zIndexOffset={500}>
                        <HoverTip offset={-50}><WarehouseInfo w={b} /></HoverTip>
                    </Marker>
                ))}
                {pts.length > 1 && (
                    <>
                        {/* ขอบขาวรองใต้เส้น ให้เส้นทางเด่นจากถนนบนแผนที่ */}
                        <Polyline positions={route.line} pathOptions={{ color: '#ffffff', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }} />
                        <Polyline positions={route.line} pathOptions={{ ...routeStyle(trip?.status), weight: 5, lineCap: 'round', lineJoin: 'round', interactive: false }} />
                    </>
                )}
                {origin && (
                    <Marker position={[Number(origin.lat), Number(origin.lng)]} icon={ICON.origin(labels ? origin.name : null)} zIndexOffset={500}>
                        <HoverTip offset={-50}><WarehouseInfo w={origin} trip={trip} /></HoverTip>
                    </Marker>
                )}
                {stops.map((s) => (
                    <Marker key={s.id} position={[Number(s.lat), Number(s.lng)]} icon={ICON.stop(s.seq, s.status, s.priority === 'urgent', labels ? s.branchName || s.label : null)}>
                        <HoverTip offset={-16}><StopInfo s={s} /></HoverTip>
                    </Marker>
                ))}
                {truckPos && (
                    <Marker position={truckPos} icon={ICON.truck} zIndexOffset={1000}>
                        <HoverTip offset={-20}>
                            <TruckInfo code={trip?.code} driver={trip?.driver?.name} plate={trip?.vehicle?.plate} pos={pos} next={stops.find((s) => s.status === 'pending')} />
                        </HoverTip>
                    </Marker>
                )}
                {trucks.map((t) => (
                    <Marker key={t.tripId} position={[Number(t.lat), Number(t.lng)]} icon={t.active ? ICON.truck : ICON.truckDark}>
                        <HoverTip offset={-20}><TruckInfo code={t.code} driver={t.driverName} pos={t} /></HoverTip>
                    </Marker>
                ))}
            </MapContainer>
            {children}
        </div>
    )
}

// ===== ข้อความตอนชี้เมาส์ที่หมุด (ทุกชนิด) =====
const hhmm = (d) => (d ? new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')
const withBranch = (name) => (name?.startsWith('สาขา') ? name : `สาขา${name}`)

const HoverTip = ({ offset, children }) => (
    <Tooltip direction="top" offset={[0, offset]} opacity={1} className="bl-tip">{children}</Tooltip>
)
// โครงกล่อง: หัวเรื่อง (+ป้าย) · บรรทัดสถานะมีจุดสี · บรรทัดรายละเอียดสีจาง
const Tip = ({ title, tag, status, sub }) => (
    // w-max: กว้างตามข้อความ (กล่อง tooltip ของ Leaflet อยู่ในชั้นที่ไม่มีความกว้าง ไม่อย่างนั้นจะหดจนตัดบรรทัดเร็ว)
    <div className="w-max max-w-[240px] whitespace-normal">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <span>{title}</span>
            {tag && <span className="rounded-md bg-danger-soft px-1 text-[10px] font-bold text-danger-ink">{tag}</span>}
        </div>
        {status && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <i className="size-1.5 shrink-0 rounded-full" style={{ background: status[1] }} />
                {status[0]}
            </div>
        )}
        {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
)

// จุดส่ง: ชื่อสาขา · สถานะและเวลา · คำขอและจำนวนสินค้า
const StopInfo = ({ s }) => {
    const items = s.items || []
    const pcs = items.reduce((t, i) => t + Number(i.qty || 0), 0)
    return (
        <Tip
            title={`${s.seq != null ? `จุดที่ ${s.seq} · ` : ''}${withBranch(s.branchName || s.label)}`}
            tag={s.priority === 'urgent' && 'ด่วน'}
            status={
                s.status === 'received' ? [`รับของแล้ว ${hhmm(s.receivedAt)}`, MAP_COLORS.onRoute]
                    : s.status === 'arrived' ? [`รถถึงแล้ว ${hhmm(s.arrivedAt)} · รอสาขานับของ`, MAP_COLORS.onRoute]
                        : s.eta ? [`ยังไม่ถึง · ถึงประมาณ ${hhmm(s.eta)}`, MAP_COLORS.waiting]
                            : s.status ? ['ยังไม่ออกรถ', MAP_COLORS.done] : null
            }
            sub={[s.requestCode, items.length ? `${items.length} รายการ · ${pcs.toLocaleString('th-TH')} ชิ้น` : null].filter(Boolean).join(' · ')}
        />
    )
}

// สาขา (ที่ไม่ได้อยู่ในเที่ยว): สถานะสต็อก · ภาค
const BranchInfo = ({ b }) => (
    <Tip
        title={withBranch(b.name)}
        status={
            b.outItems > 0 ? [`ของหมด ${b.outItems} รายการ${b.lowItems > 0 ? ` · ใกล้หมด ${b.lowItems}` : ''}`, MAP_COLORS.out]
                : b.lowItems > 0 ? [`ใกล้หมด ${b.lowItems} รายการ`, MAP_COLORS.low]
                    : ['สต็อกปกติ', MAP_COLORS.done]
        }
        sub={[b.code, b.region].filter(Boolean).join(' · ')}
    />
)

// คลังกลาง: ชื่อ · จุดเริ่มต้นของเที่ยว · ที่อยู่
const WarehouseInfo = ({ w, trip }) => (
    <Tip
        title={w.name}
        status={trip ? [trip.startedAt ? `ออกจากคลัง ${hhmm(trip.startedAt)}` : 'จุดเริ่มต้น · ยังไม่ออกรถ', trip.startedAt ? MAP_COLORS.onRoute : MAP_COLORS.waiting] : ['คลังกลาง · จุดเริ่มต้นของทุกเที่ยว', MAP_COLORS.waiting]}
        sub={w.address}
    />
)

// รถ: เที่ยว · คนขับ ทะเบียน · ความเร็ว · ตำแหน่งล่าสุดเมื่อไหร่ · จุดถัดไป
const TruckInfo = ({ code, driver, plate, pos, next }) => (
    <Tip
        title={[code, driver].filter(Boolean).join(' · ')}
        status={[`${pos?.speed != null ? `${Math.round(pos.speed)} กม./ชม.` : 'กำลังวิ่ง'}${pos?.at ? ` · อัปเดต ${hhmm(pos.at)}` : ''}`, MAP_COLORS.onRoute]}
        sub={[plate, next ? `ถัดไป ${withBranch(next.branchName || next.label)}${next.eta ? ` ${hhmm(next.eta)}` : ''}` : null].filter(Boolean).join(' · ')}
    />
)

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
