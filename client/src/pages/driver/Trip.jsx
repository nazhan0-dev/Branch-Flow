import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronUp, Navigation } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { TRIP_STATUS, countdown, minutesUntil, time } from '../../lib/format'
import { fmtKm, nearestIndex, roadKm, walkAlong } from '../../lib/geo'
import TripMap from '../../components/TripMap'
import { Badge, Button, ErrorBox, Loading, Num, Segmented, StatusBadge } from '../../components/ui'

const SEND_EVERY_MS = 8000
const SIM_STEP_MS = 3000
const SIM_STEP_KM = 0.4 // ระยะต่อรอบในโหมดจำลอง (เร่งให้เห็นผลเร็ว ~8 กม./นาที)
const GPS_LABEL = { live: 'ส่งตำแหน่งอยู่ (GPS)', sim: 'ส่งตำแหน่งอยู่ (จำลอง)', denied: 'ไม่ได้รับสิทธิ์ GPS', off: 'หยุดส่งตำแหน่ง' }

export default function DriverTrip() {
    const { id } = useParams()
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
            <div className="absolute inset-0"><TripMap trip={trip} truck={pos} onRoute={onRouteLoaded} labels className="h-full" rounded="" zoomControl={false} fitPad={[onRoute ? 150 : 90, sheetH + 16]} /></div>

            {/* แถบบน: ระยะถึงจุดถัดไป */}
            <div className="absolute inset-x-4 top-4 z-[500] flex flex-col gap-2.5">
                {next && trip.status !== 'completed' ? (
                    <div className="flex items-center gap-3.5 rounded-[20px] bg-ink p-4 text-white">
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
                    <div className="flex items-center gap-3 rounded-[20px] bg-white p-3.5">
                        <button aria-label="ย้อนกลับ" onClick={() => navigate('/driver')} className="grid size-9 place-items-center rounded-xl border border-line"><ChevronLeft size={18} /></button>
                        <span className="font-semibold">{trip.code}</span>
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
            <div ref={sheetRef} className={`absolute inset-x-0 bottom-0 z-[510] flex max-h-[62%] flex-col overflow-y-auto overscroll-contain rounded-t-[24px] bg-white px-5 shadow-[0_-4px_20px_rgba(0,0,0,.06)] ${collapsed ? 'gap-2 pb-3' : 'gap-3.5 pb-5'}`}>
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
                                <a href={mapsUrl} target="_blank" rel="noreferrer" aria-label="นำทางด้วย Google Maps" className="grid size-9 shrink-0 place-items-center rounded-xl border border-line"><Navigation size={16} /></a>
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
                            <div className="text-xs text-muted">จุดที่ {focus.seq} จาก {trip.stopCount}</div>
                            <div className="flex items-center gap-1.5 text-[22px] font-semibold">สาขา{focus.branchName} {focus.priority === 'urgent' && <Badge tone="danger">ด่วน</Badge>}</div>
                            <div className="text-xs text-muted">{focus.address}{next ? ` · ${fmtKm(km)}` : ''}</div>
                        </div>
                        {mapsUrl && (
                            <a href={mapsUrl} target="_blank" rel="noreferrer" aria-label="นำทางด้วย Google Maps" className="grid size-11 shrink-0 place-items-center rounded-[14px] border border-line"><Navigation size={18} /></a>
                        )}
                    </div>
                )}
                {focus && !collapsed && (
                    <div className="rounded-2xl bg-soft px-3.5">
                        {focus.items.map((i) => (
                            <div key={i.sku} className="flex justify-between border-b border-[#e9ece7] py-3 text-sm last:border-0">
                                <span>{i.name} <span className="text-faint">{i.sku}</span></span>
                                <b>{i.qty}</b>
                            </div>
                        ))}
                    </div>
                )}

                {!collapsed && (
                    <>
                        <ErrorBox>{err}</ErrorBox>
                        {trip.status === 'assigned' && <Button size="lg" loading={busy === 'accept'} onClick={accept}>รับงาน</Button>}
                        {trip.status === 'accepted' && <Button variant="brand" size="lg" loading={busy === 'start'} onClick={start}>ออกเดินทาง (โหลดของขึ้นรถแล้ว)</Button>}
                        {onRoute && next && <Button variant="brand" size="lg" loading={busy === 'arrive'} onClick={() => arrive(next)}>ถึงสาขาแล้ว</Button>}
                        {onRoute && !next && <div className="rounded-2xl bg-warn-soft px-4 py-3 text-center text-sm text-warn-ink">ส่งครบทุกจุดแล้ว · รอสาขานับและยืนยันรับของ</div>}
                        {trip.status === 'completed' && <div className="rounded-2xl bg-brand-soft px-4 py-3 text-center text-sm font-semibold text-brand-ink">ส่งครบทุกจุดแล้ว ขอบคุณครับ</div>}
                    </>
                )}

                {onRoute && !collapsed && <Segmented full items={[['live', 'GPS มือถือ'], ['sim', 'จำลองการวิ่ง'], ['off', 'หยุด']]} value={gps === 'denied' ? 'off' : gps} onChange={setGps} />}

                {!collapsed && (
                    <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-center gap-1 text-sm font-semibold">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />} {expanded ? 'ซ่อนจุดส่ง' : `ดูทุกจุดส่ง (${trip.stopCount})`}
                    </button>
                )}
                {expanded && !collapsed &&
                    trip.stops.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 border-b border-[#f0f2ef] pb-3 last:border-0">
                            <Num n={s.seq} tone={s.status === 'pending' ? 'dark' : 'muted'} />
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold">{s.branchName}</div>
                                <div className="text-xs text-muted">{s.requestCode} · {s.items.length} รายการ</div>
                            </div>
                            <span className="text-xs text-muted">{s.status === 'received' ? 'รับแล้ว' : s.status === 'arrived' ? 'ถึงแล้ว' : s.eta ? `ETA ${time(s.eta)}` : ''}</span>
                        </div>
                    ))}
            </div>
        </div>
    )
}
