import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronUp, Clock, MapPin, Navigation, Package, Truck } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useNow } from '../../lib/useNow'
import { useSocket } from '../../lib/socket'
import { TRIP_STATUS, countdown, minutesUntil, time } from '../../lib/format'
import { fmtKm, nearestIndex, roadKm, walkAlong } from '../../lib/geo'
import TripMap from '../../components/TripMap'
import { Badge, Button, ErrorBox, Loading, StatusBadge } from '../../components/ui'

const SEND_EVERY_MS = 8000
const SIM_STEP_MS = 3000
const SIM_STEP_KM = 0.4 // ระยะต่อรอบในโหมดจำลอง (เร่งให้เห็นผลเร็ว ~8 กม./นาที)
const GPS_LABEL = { live: 'ส่งตำแหน่งอยู่ (GPS)', sim: 'ส่งตำแหน่งอยู่ (จำลอง)', denied: 'ไม่ได้รับสิทธิ์ GPS', off: 'หยุดส่งตำแหน่ง' }

export default function DriverTrip() {
    const { id } = useParams()
    useNow() // เวลา/นับถอยหลังบนหน้าเดินเองทุก 30 วินาที
    const navigate = useNavigate()
    const { data: trip, error, loading, reload } = useApi(`/trips/${id}`)
    const [busy, setBusy] = useState('')
    const [err, setErr] = useState('')
    const [pos, setPos] = useState(null)
    const [gps, setGps] = useState('off') // off | live | sim | denied
    const [expanded, setExpanded] = useState(false) // แสดงรายการทุกจุดส่ง
    const [collapsed, setCollapsed] = useState(false) // พับแผ่นข้อมูลลง ให้เห็นแผนที่เต็ม ๆ
    const [sheetH, setSheetH] = useState(Math.round(window.innerHeight * 0.5))
    const dragY = useRef(null)
    const [roadLine, setRoadLine] = useState(null)
    // วัดความสูงจริงของแผ่นข้อมูล แผนที่จะได้จัดมุมมองไว้ในส่วนที่ยังมองเห็น
    const sheetRef = useCallback((node) => {
        if (!node) return
        const ro = new ResizeObserver(() => setSheetH(node.offsetHeight))
        ro.observe(node)
        return () => ro.disconnect()
    }, [])
    const lastSent = useRef(0)
    const posRef = useRef(null)
    const sim = useRef(null) // { line, idx, point } ตำแหน่งบนเส้นทางในโหมดจำลอง
    posRef.current = pos
    const onRouteLoaded = useCallback((r) => setRoadLine(r.line), [])

    useSocket('trip_changed', useCallback(() => reload(), [reload]))
    useSocket('notification', useCallback(() => reload(), [reload]))

    const onRoute = trip?.status === 'on_route'
    const next = trip?.stops.find((s) => s.status === 'pending')

    // เปิดหน้าตอนกำลังวิ่งอยู่แล้ว → ส่งตำแหน่งต่ออัตโนมัติ
    useEffect(() => {
        if (onRoute && gps === 'off' && !pos) {
            setGps(navigator.geolocation && window.matchMedia('(pointer: coarse)').matches ? 'live' : 'sim')
            if (trip.lastLocation) setPos({ lat: Number(trip.lastLocation.lat), lng: Number(trip.lastLocation.lng) })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onRoute])

    const send = useCallback(
        (p, force) => {
            setPos(p)
            if (!force && Date.now() - lastSent.current < SEND_EVERY_MS) return
            lastSent.current = Date.now()
            api.post(`/trips/${id}/location`, p).catch(() => {})
        },
        [id]
    )

    // GPS จริงจากมือถือ (ต้องเปิดผ่าน https หรือ localhost)
    useEffect(() => {
        if (!onRoute || gps !== 'live') return
        if (!navigator.geolocation) return setGps('denied')
        const w = navigator.geolocation.watchPosition(
            (p) => send({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed ? Math.round(p.coords.speed * 3.6) : null }),
            () => setGps('denied'),
            { enableHighAccuracy: true, maximumAge: 5000 }
        )
        return () => navigator.geolocation.clearWatch(w)
    }, [onRoute, gps, send])

    // โหมดจำลอง: รถวิ่งไปตามเส้นถนนจนถึงจุดส่งถัดไป แล้วจอดรอให้คนขับกด "ถึงสาขาแล้ว"
    useEffect(() => {
        if (!onRoute || gps !== 'sim' || !next) return
        const line = roadLine?.length > 1 ? roadLine : [[Number(trip.origin.lat), Number(trip.origin.lng)], ...trip.stops.map((s) => [Number(s.lat), Number(s.lng)])]
        const target = { lat: Number(next.lat), lng: Number(next.lng) }
        // เริ่มใหม่เมื่อเส้นทางเปลี่ยน (เช่นได้เส้นถนนจาก OSRM หลังเปิดหน้า) โดยต่อจากตำแหน่งล่าสุด
        if (sim.current?.line !== line) {
            const p = posRef.current
            const idx = p ? nearestIndex(line, p) : 0
            sim.current = { line, idx, point: p ? { lat: p.lat, lng: p.lng } : { lat: line[0][0], lng: line[0][1] } }
        }
        const tick = () => {
            const s = sim.current
            const targetIdx = nearestIndex(line, target, s.idx)
            const moved = walkAlong(line, s, SIM_STEP_KM, targetIdx)
            const point = moved.idx >= targetIdx ? target : moved.point
            sim.current = { line, idx: moved.idx, point }
            const p = { ...point, speed: point === target ? 0 : 35 }
            setPos(p)
            api.post(`/trips/${id}/location`, p).catch(() => {})
        }
        const t = setInterval(tick, SIM_STEP_MS)
        return () => clearInterval(t)
    }, [onRoute, gps, next, trip, id, roadLine])

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>

    const run = async (key, fn) => {
        setBusy(key)
        setErr('')
        try {
            await fn()
            await reload()
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy('')
        }
    }
    const accept = () => run('accept', () => api.post(`/trips/${id}/accept`))
    const start = () =>
        run('start', async () => {
            await api.post(`/trips/${id}/start`)
            // มือถือใช้ GPS จริง, คอมพิวเตอร์ใช้โหมดจำลองเพื่อทดลอง flow
            setGps(navigator.geolocation && window.matchMedia('(pointer: coarse)').matches ? 'live' : 'sim')
        })
    const arrive = (stop) =>
        run('arrive', async () => {
            // โหมดจำลอง: กดถึงก่อนรถจำลองวิ่งถึง → ย้ายรถไปที่สาขาเลย ไม่ให้ค้างกลางทาง
            if (gps === 'sim') {
                const at = { lat: Number(stop.lat), lng: Number(stop.lng), speed: 0 }
                if (sim.current) sim.current = { ...sim.current, idx: nearestIndex(sim.current.line, at, sim.current.idx), point: at }
                send(at, true)
            } else if (pos) send(pos, true)
            await api.post(`/trips/${id}/stops/${stop.id}/arrive`)
        })

    const here = pos || (trip.lastLocation?.lat != null ? trip.lastLocation : trip.origin)
    const focus = next || trip.stops.at(-1)
    const km = next ? roadKm(here, next) : 0
    const left = next?.eta ? minutesUntil(next.eta) : null
    const mapsUrl = next && `https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}&travelmode=driving`

    return (
        <div className="relative h-[calc(100dvh-76px)] overflow-hidden">
            {/* --sheet: ยกปุ่ม/ลิขสิทธิ์มุมล่างของ Leaflet ขึ้นไปอยู่เหนือแผ่นข้อมูล (ต้องแสดงลิขสิทธิ์ OSM ไว้เสมอ) */}
            <div className="bl-sheet-map absolute inset-0" style={{ '--sheet': `${sheetH}px` }}><TripMap trip={trip} truck={pos} onRoute={onRouteLoaded} labels className="h-full" rounded="" zoomControl={false} fitPad={[onRoute ? 150 : 90, sheetH + 16]} /></div>

            {/* แถบบน: ระยะถึงจุดถัดไป */}
            <div className="absolute inset-x-4 top-4 z-[500] flex flex-col gap-2.5">
                {next && trip.status !== 'completed' ? (
                    <div className="flex items-center gap-3.5 rounded-[20px] bg-ink p-4 text-white shadow-[0_8px_24px_rgba(20,22,20,0.18)]">
                        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand"><ArrowUpRight size={24} /></span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[22px] font-semibold leading-tight">{fmtKm(km)}</div>
                            <div className="truncate text-xs text-[#b9beb7]">ไปสาขา{next.branchName}</div>
                        </div>
                        <div className="text-right">
                            <div className="font-semibold">{next.eta ? time(next.eta) : '–'}</div>
                            <div className="text-[11px] text-[#b9beb7]">{left != null ? countdown(left) : 'ยังไม่ออกรถ'}</div>
                        </div>
                    </div>
                ) : (
                    // หน้าตาเดียวกับช่องค้นหาบนแผนที่: สูง 44 มุม 14 เงาบาง ไอคอนเทาไม่มีกรอบ
                    <div className="flex h-11 w-fit items-center rounded-[14px] bg-white pr-3 text-sm shadow-sm">
                        <button aria-label="ย้อนกลับ" onClick={() => navigate('/driver')} className="grid size-11 shrink-0 place-items-center rounded-l-[14px] text-[#9aa097] transition-colors hover:text-ink"><ChevronLeft size={18} /></button>
                        <span className="mr-2.5 font-semibold">{trip.code}</span>
                        <StatusBadge map={TRIP_STATUS} value={trip.status} />
                    </div>
                )}
                {onRoute && (
                    <span className="flex w-fit items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold shadow-sm">
                        <i className={`size-2.5 rounded-full ${gps === 'live' || gps === 'sim' ? 'bg-brand' : 'bg-danger'}`} />
                        {GPS_LABEL[gps]}
                    </span>
                )}
            </div>

            {/* แผ่นข้อมูลด้านล่าง */}
            {/* z-[1010]: อยู่เหนือชั้นปุ่มมุมล่างของ Leaflet (z 1000) */}
            <div ref={sheetRef} className={`absolute inset-x-0 bottom-0 z-[1010] flex max-h-[62%] flex-col overflow-y-auto overscroll-contain rounded-t-[26px] bg-white px-5 shadow-[0_-6px_24px_rgba(20,22,20,.08)] ${collapsed ? 'gap-2 pb-3' : 'gap-4 pb-5'}`}>
                {/* ที่จับ: แตะเพื่อพับ/กาง หรือลากลง/ขึ้น */}
                <button
                    type="button"
                    aria-label={collapsed ? 'กางข้อมูลเที่ยวส่ง' : 'พับข้อมูลลงเพื่อดูแผนที่'}
                    aria-expanded={!collapsed}
                    className={`sticky top-0 z-10 -mx-5 flex shrink-0 cursor-grab touch-none justify-center bg-white ${collapsed ? 'pt-2 pb-0' : 'pt-3 pb-1'}`}
                    onPointerDown={(e) => {
                        dragY.current = e.clientY
                        e.currentTarget.setPointerCapture(e.pointerId)
                    }}
                    onPointerUp={(e) => {
                        const dy = dragY.current == null ? 0 : e.clientY - dragY.current
                        dragY.current = null
                        if (dy > 24) setCollapsed(true)
                        else if (dy < -24) setCollapsed(false)
                        else setCollapsed((c) => !c)
                    }}
                    onPointerCancel={() => (dragY.current = null)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setCollapsed((c) => !c))}
                >
                    <span className="h-1.5 w-11 rounded-full bg-[#cfd3cd]" />
                </button>
                {/* พับ: แถวเดียว ชื่อสาขา + ปุ่มหลักขนาดเล็ก */}
                {collapsed && (
                    <>
                        <div className="flex items-center gap-2.5">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 truncate font-semibold">
                                    {focus ? `สาขา${focus.branchName}` : trip.code}
                                    {focus?.priority === 'urgent' && <Badge tone="danger">ด่วน</Badge>}
                                </div>
                                <div className="truncate text-xs text-muted">
                                    {focus ? `จุดที่ ${focus.seq}/${trip.stopCount}` : ''}{next && onRoute ? ` · ${fmtKm(km)}` : ''}{next?.eta && onRoute ? ` · ถึง ${time(next.eta)}` : ''}
                                </div>
                            </div>
                            {mapsUrl && (
                                <a href={mapsUrl} target="_blank" rel="noreferrer" aria-label="นำทางด้วย Google Maps" className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink"><Navigation size={16} /></a>
                            )}
                            {trip.status === 'assigned' && <Button size="sm" loading={busy === 'accept'} onClick={accept}>รับงาน</Button>}
                            {trip.status === 'accepted' && <Button variant="brand" size="sm" loading={busy === 'start'} onClick={start}>ออกเดินทาง</Button>}
                            {onRoute && next && <Button variant="brand" size="sm" loading={busy === 'arrive'} onClick={() => arrive(next)}>ถึงแล้ว</Button>}
                            {onRoute && !next && <Badge tone="warn">รอสาขารับของ</Badge>}
                            {trip.status === 'completed' && <Badge tone="brand">ส่งครบแล้ว</Badge>}
                        </div>
                        <ErrorBox>{err}</ErrorBox>
                    </>
                )}

                {focus && !collapsed && (
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs text-muted">
                                <span>จุดที่ {focus.seq} จาก {trip.stopCount}</span>
                                {/* จุดเล็กแสดงความคืบหน้าแต่ละจุด */}
                                <span className="flex gap-1">
                                    {trip.stops.map((s) => (
                                        <i key={s.id} className={`h-1.5 rounded-full transition-all ${s.id === focus.id ? 'w-4 bg-ink' : s.status !== 'pending' ? 'w-1.5 bg-brand' : 'w-1.5 bg-[#dfe3dd]'}`} />
                                    ))}
                                </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[22px] leading-tight font-semibold">สาขา{focus.branchName} {focus.priority === 'urgent' && <Badge tone="danger">ด่วน</Badge>}</div>
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted"><MapPin size={12} className="shrink-0" /><span className="truncate">{focus.address}{next ? ` · ${fmtKm(km)}` : ''}</span></div>
                        </div>
                        {mapsUrl && (
                            <a href={mapsUrl} target="_blank" rel="noreferrer" aria-label="นำทางด้วย Google Maps" className="flex shrink-0 flex-col items-center gap-0.5 text-[10px] font-semibold text-brand-ink">
                                <span className="grid size-11 place-items-center rounded-[14px] bg-brand-soft transition-colors hover:bg-[#d4eedf]"><Navigation size={18} /></span>
                                นำทาง
                            </a>
                        )}
                    </div>
                )}
                {focus && !collapsed && (
                    <div className="rounded-2xl border border-[#eef0ed]">
                        <div className="flex items-center justify-between px-3.5 pt-3 pb-1 text-xs text-muted">
                            <span className="flex items-center gap-1.5"><Package size={13} /> สินค้าที่ต้องส่ง</span>
                            <span>{focus.items.length} รายการ · {focus.items.reduce((s, i) => s + Number(i.qty), 0)} ชิ้น</span>
                        </div>
                        <div className="px-3.5">
                            {focus.items.map((i) => (
                                <div key={i.sku} className="flex items-center justify-between border-b border-[#f0f2ef] py-2.5 text-sm last:border-0">
                                    <span className="min-w-0 truncate">{i.name} <span className="text-faint">{i.sku}</span></span>
                                    <b className="tabular-nums">{i.qty}</b>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {!collapsed && (
                    <>
                        <ErrorBox>{err}</ErrorBox>
                        {trip.status === 'assigned' && <Button size="lg" loading={busy === 'accept'} onClick={accept}>รับงาน</Button>}
                        {trip.status === 'accepted' && <Button variant="brand" size="lg" loading={busy === 'start'} onClick={start}><Truck size={18} /> ออกเดินทาง (โหลดของขึ้นรถแล้ว)</Button>}
                        {onRoute && next && <Button variant="brand" size="lg" loading={busy === 'arrive'} onClick={() => arrive(next)}><MapPin size={18} /> ถึงสาขาแล้ว</Button>}
                        {onRoute && !next && (
                            <div className="flex items-center gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn-ink">
                                <Clock size={18} className="shrink-0" />
                                <span><b className="font-semibold">ส่งครบทุกจุดแล้ว</b> · รอสาขานับและยืนยันรับของ</span>
                            </div>
                        )}
                        {trip.status === 'completed' && (
                            <div className="flex items-center gap-3 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand-ink">
                                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-white"><Check size={15} /></span>
                                <span><b className="font-semibold">ส่งครบทุกจุดแล้ว</b> · ขอบคุณครับ</span>
                            </div>
                        )}
                    </>
                )}

                {/* โหมดส่งตำแหน่ง: แถวเดียว ป้ายซ้าย ปุ่มเลือกขวา */}
                {onRoute && !collapsed && (
                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-soft p-1.5 pl-3.5">
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                            <i className={`size-2 rounded-full ${gps === 'live' || gps === 'sim' ? 'bg-brand' : 'bg-danger'}`} /> ตำแหน่ง
                        </span>
                        <div className="flex gap-1">
                            {[['live', 'GPS'], ['sim', 'จำลอง'], ['off', 'หยุด']].map(([k, l]) => {
                                const on = (gps === 'denied' ? 'off' : gps) === k
                                return (
                                    <button key={k} type="button" onClick={() => setGps(k)} className={`h-8 rounded-[10px] px-3.5 text-xs transition-colors ${on ? 'bg-white font-semibold shadow-sm' : 'text-muted hover:text-ink'}`}>
                                        {l}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {!collapsed && (
                    <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-center gap-1 text-sm font-semibold text-muted hover:text-ink">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {expanded ? 'ซ่อนจุดส่ง' : `ดูทุกจุดส่ง (${trip.stopCount})`}
                    </button>
                )}
                {/* ทุกจุดส่งแบบไทม์ไลน์: เส้นเชื่อมระหว่างจุด จุดที่ส่งแล้วเป็นสีเขียว */}
                {expanded && !collapsed && (
                    <div className="bl-fade">
                        {trip.stops.map((s, i) => {
                            const done = s.status !== 'pending'
                            const isNext = s.id === next?.id
                            return (
                                <div key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
                                    {i < trip.stops.length - 1 && <span className={`absolute top-7 bottom-0 left-[13px] w-0.5 ${done ? 'bg-brand' : 'bg-[#e3e6e1]'}`} />}
                                    <span className={`relative grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? 'bg-brand text-white' : isNext ? 'bg-ink text-white' : 'border-2 border-[#dfe3dd] bg-white text-muted'}`}>
                                        {done ? <Check size={14} /> : s.seq}
                                    </span>
                                    <div className="min-w-0 flex-1 pt-0.5">
                                        <div className={`font-semibold ${done ? 'text-muted' : ''}`}>สาขา{s.branchName}</div>
                                        <div className="text-xs text-muted">{s.requestCode} · {s.items.length} รายการ</div>
                                    </div>
                                    <span className={`pt-1 text-xs ${isNext ? 'font-semibold text-ink' : 'text-muted'}`}>
                                        {s.status === 'received' ? 'รับแล้ว' : s.status === 'arrived' ? 'ถึงแล้ว' : s.eta ? `ถึง ${time(s.eta)}` : ''}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
