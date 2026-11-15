import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { time, weight } from '../../lib/format'
import { estimateEtas, fmtDuration, fmtKm, nearestOrder } from '../../lib/geo'
import TripMap from '../../components/TripMap'
import { Avatar, Badge, Bar, Button, Card, Check, Empty, ErrorBox, Loading, Num, PageHeader } from '../../components/ui'

const round = () => {
    const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false }))
    return h < 12 ? 'รอบเช้า' : h < 16 ? 'รอบบ่าย' : 'รอบเย็น'
}

export default function Planner() {
    const navigate = useNavigate()
    const reqs = useApi('/requests?status=approved')
    const branches = useApi('/branches')
    const drivers = useApi('/drivers')
    const vehicles = useApi('/vehicles')
    const [stops, setStops] = useState([]) // ลำดับจุดส่ง (request ids)
    const [filter, setFilter] = useState('all')
    const [driverId, setDriverId] = useState(null)
    const [vehicleId, setVehicleId] = useState(null)
    const [road, setRoad] = useState({})
    const [drag, setDrag] = useState(null)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    const reloadReqs = reqs.reload
    useSocket('requests_changed', useCallback(() => reloadReqs(), [reloadReqs]))

    const byBranch = useMemo(() => new Map((branches.data || []).map((b) => [b.id, b])), [branches.data])
    const origin = (branches.data || []).find((b) => b.isWarehouse)
    const open = useMemo(
        () => (reqs.data || []).filter((r) => !r.tripCode).map((r) => ({ ...byBranch.get(r.branchId), ...r })),
        [reqs.data, byBranch]
    )
    const byId = useMemo(() => new Map(open.map((r) => [r.id, r])), [open])
    const chosen = stops.map((id) => byId.get(id)).filter(Boolean)
    const regions = [...new Set(open.map((r) => r.region))]
    const listed = open.filter((r) => filter === 'all' || (filter === 'urgent' ? r.priority === 'urgent' : r.region === filter))

    const plan = useMemo(() => (origin && chosen.length ? estimateEtas(origin, chosen) : null), [origin, chosen])
    const kg = chosen.reduce((s, r) => s + Number(r.weightTon || 0) * 1000, 0)
    // รถว่าง = ไม่ซ่อม และไม่ติดเที่ยวที่ยังไม่จบ (มอบงานแล้วแต่ยังไม่ออกก็นับว่าไม่ว่าง)
    const freeVehicles = (vehicles.data || []).filter((v) => v.status === 'available' && !Number(v.busy))
    const vehicle = (vehicles.data || []).find((v) => v.id === vehicleId)
    const freeDrivers = (drivers.data || []).filter((d) => !Number(d.onRoute))
    const mapTrip = useMemo(
        () => origin && { origin, status: 'plan', stops: chosen.map((r, i) => ({ id: r.id, seq: i + 1, lat: r.lat, lng: r.lng, branchName: r.branchName, priority: r.priority, status: 'pending' })) },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [origin, stops, byId]
    )

    if ([reqs, branches, drivers, vehicles].some((x) => x.loading)) return <Loading />
    const loadError = reqs.error || branches.error || drivers.error || vehicles.error
    if (loadError) return <ErrorBox>{loadError}</ErrorBox>

    const toggle = (id) => setStops(stops.includes(id) ? stops.filter((s) => s !== id) : [...stops, id])
    const autoOrder = () => setStops(nearestOrder(origin, chosen).map((r) => r.id))
    const dropOn = (target) => {
        if (drag == null || drag === target) return
        const next = stops.filter((s) => s !== drag)
        next.splice(next.indexOf(target) + (stops.indexOf(drag) < stops.indexOf(target) ? 1 : 0), 0, drag)
        setStops(next)
        setDrag(null)
    }
    const dId = driverId ?? freeDrivers[0]?.id ?? null
    // รถประจำของคนขับที่เลือก ใช้ได้ถ้าว่างและบรรทุกพอ
    const fits = (id) => freeVehicles.some((v) => v.id === id && v.capacityKg >= kg)
    const regular = (drivers.data || []).find((d) => d.id === dId)?.defaultVehicleId
    // เลือกรถให้อัตโนมัติ: รถประจำก่อน ถ้าใช้ไม่ได้ เลือกคันเล็กสุดที่บรรทุกพอ
    const vId = vehicleId ?? (fits(regular) ? regular : null) ?? [...freeVehicles].sort((a, b) => a.capacityKg - b.capacityKg).find((v) => v.capacityKg >= kg)?.id ?? null
    const pickDriver = (d) => {
        setDriverId(d.id)
        // เปลี่ยนคนขับ → ใช้รถประจำของคนนั้นถ้าว่าง ไม่อย่างนั้นปล่อยให้ระบบเลือกให้
        setVehicleId(fits(d.defaultVehicleId) ? d.defaultVehicleId : null)
    }
    const plateOf = (id) => (vehicles.data || []).find((v) => v.id === id)?.plate
    const cap = (vehicle || freeVehicles.find((v) => v.id === vId))?.capacityKg || 0

    const create = async () => {
        setBusy(true)
        setErr('')
        try {
            const res = await api.post('/trips', { driver_id: dId, vehicle_id: vId, request_ids: chosen.map((r) => r.id) })
            navigate(`/admin/trips/${res.data.id}`)
        } catch (e) {
            setErr(errMsg(e))
            setBusy(false)
        }
    }

    return (
        <>
            <PageHeader
                title="จัดเที่ยวส่ง"
                sub={`${round()} · คำขออนุมัติแล้วรอจัดรถ ${open.length} รายการ`}
                actions={
                    <>
                        <Button variant="chip">{round()}</Button>
                        <Button variant="chip" disabled={chosen.length < 2} onClick={autoOrder}>จัดลำดับอัตโนมัติ</Button>
                    </>
                }
            />
            <div className="grid gap-4 xl:grid-cols-[340px_1fr_340px]">
                <Card className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <div className="text-lg font-semibold">คำขอรอจัดส่ง</div>
                        <span className="text-xs text-muted">เลือก {chosen.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {[['all', `ทั้งหมด ${open.length}`, 'neutral'], ['urgent', `ด่วน ${open.filter((r) => r.priority === 'urgent').length}`, 'danger'], ...regions.map((r) => [r, r.replace(' และปริมณฑล', ''), 'neutral'])].map(([k, label, tone]) => (
                            <button key={k} onClick={() => setFilter(k)} className={`rounded-lg ${filter === k ? 'ring-2 ring-ink/70' : ''}`}><Badge tone={tone}>{label}</Badge></button>
                        ))}
                    </div>
                    {listed.length === 0 && <Empty>ไม่มีคำขอที่อนุมัติแล้วรอจัดรถ</Empty>}
                    <div>
                        {listed.map((r) => (
                            <button key={r.id} onClick={() => toggle(r.id)} className="flex w-full items-center gap-3 border-b border-[#f0f2ef] py-3 text-left last:border-0">
                                <Check on={stops.includes(r.id)} />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-semibold">{r.branchName}</span>
                                    <span className="block text-xs text-muted">{r.code} · {r.itemCount} รายการ · {weight(r.weightTon)}</span>
                                </span>
                                {r.priority === 'urgent' ? <Badge tone="danger">ด่วน</Badge> : <Badge tone="warn">ปกติ</Badge>}
                            </button>
                        ))}
                    </div>
                </Card>

                <TripMap
                    trip={mapTrip}
                    // หมุดสาขาที่ยังไม่ได้เลือก: สาขาเดียวมีหลายคำขอได้ จึงรวมเหลือหมุดเดียวต่อสาขา
                    branches={[...new Map(open.filter((r) => !stops.includes(r.id)).map((r) => [r.branchId, { ...r, id: r.branchId, outItems: 0, lowItems: 0 }])).values()]}
                    labels
                    className="h-[420px] xl:h-auto xl:min-h-[640px]"
                    onRoute={setRoad}
                >
                    {plan && (
                        <div className="absolute top-4 left-4 z-[500] flex gap-4 rounded-[14px] bg-white px-3.5 py-2.5 text-xs shadow-sm">
                            <span><b>{fmtKm(road.km ?? plan.totalKm)}</b> <span className="text-muted">ระยะทาง</span></span>
                            <span><b>{fmtDuration(plan.minutes)}</b> <span className="text-muted">เวลาโดยประมาณ (รวมลงของ)</span></span>
                        </div>
                    )}
                </TripMap>

                <Card className="flex flex-col gap-3">
                    <div className="text-lg font-semibold">เที่ยวส่งใหม่</div>
                    <div className="text-xs text-muted">ลำดับจุดส่ง {chosen.length > 1 && '· ลากเพื่อสลับ'}</div>
                    {chosen.length === 0 && <Empty>เลือกคำขอทางซ้าย</Empty>}
                    <div>
                        {chosen.map((r, i) => (
                            <div
                                key={r.id}
                                draggable
                                onDragStart={() => setDrag(r.id)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => dropOn(r.id)}
                                className={`flex cursor-grab items-center gap-3 border-b border-[#f0f2ef] py-3 last:border-0 ${drag === r.id ? 'opacity-40' : ''}`}
                            >
                                <Num n={i + 1} tone={r.priority === 'urgent' ? 'danger' : 'dark'} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5 font-semibold">{r.branchName} {r.priority === 'urgent' && <Badge tone="danger">ด่วน</Badge>}</span>
                                    <span className="block text-xs text-muted">ถึง ~{time(plan.list[i].eta)}</span>
                                </span>
                                <span className="text-faint" aria-hidden>⋮⋮</span>
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-between text-xs"><span className="text-muted">น้ำหนักบนรถ</span><b>{weight(kg / 1000)} / {(cap / 1000).toFixed(1)} ตัน</b></div>
                    <Bar pct={cap ? (100 * kg) / cap : 0} tone={cap && kg > cap ? 'danger' : 'brand'} className="w-full" />

                    <div className="text-xs text-muted">เลือกรถ (ว่าง {freeVehicles.length})</div>
                    {freeVehicles.map((v) => (
                        <Choice key={v.id} on={vId === v.id} onClick={() => setVehicleId(v.id)} disabled={v.capacityKg < kg} title={v.plate} sub={`${v.type} · ${(v.capacityKg / 1000).toFixed(1)} ตัน${v.capacityKg < kg ? ' · บรรทุกไม่พอ' : ''}`} />
                    ))}
                    <div className="text-xs text-muted">เลือกคนขับ (ว่าง {freeDrivers.length})</div>
                    {(drivers.data || []).map((d) => (
                        <Choice
                            key={d.id}
                            on={dId === d.id}
                            onClick={() => pickDriver(d)}
                            avatar={d.name}
                            title={d.name}
                            sub={`${Number(d.onRoute) ? 'กำลังวิ่งอีกเที่ยว' : Number(d.queued) ? `มีงานรอ ${d.queued} เที่ยว` : 'ว่าง'}${d.defaultVehicleId ? ` · รถประจำ ${plateOf(d.defaultVehicleId) ?? '–'}` : ''}`}
                        />
                    ))}

                    <ErrorBox>{err}</ErrorBox>
                    <p className="mt-auto text-center text-xs text-muted">คนขับจะได้รับงานในแอปทันที</p>
                    <Button size="lg" disabled={!chosen.length || !dId || !vId || kg > cap} loading={busy} onClick={create}>มอบหมายเที่ยวส่ง</Button>
                </Card>
            </div>
        </>
    )
}

// การ์ดตัวเลือกแบบ radio (รถ / คนขับ)
const Choice = ({ on, onClick, disabled, avatar, title, sub }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`flex items-center gap-3 rounded-2xl border p-3 text-left disabled:opacity-40 ${on ? 'border-2 border-ink' : 'border-line'}`}
    >
        {avatar && <Avatar name={avatar} tone={on ? 'blue' : 'amber'} />}
        <span className="min-w-0 flex-1">
            <span className="block font-semibold">{title}</span>
            <span className="block text-xs text-muted">{sub}</span>
        </span>
        <span className={`size-5 shrink-0 rounded-full border-[1.5px] ${on ? 'border-ink bg-ink' : 'border-[#cfd3cd]'}`} />
    </button>
)
