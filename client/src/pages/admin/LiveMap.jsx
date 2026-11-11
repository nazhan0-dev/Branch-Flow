import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Phone } from 'lucide-react'
import api from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { TRIP_STATUS, num, time } from '../../lib/format'
import TripMap from '../../components/TripMap'
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Loading, SearchInput, StatusBadge, Timeline } from '../../components/ui'

const ACTIVE = ['assigned', 'accepted', 'on_route']
const FILTERS = [
    ['active', 'ทั้งหมดที่ทำงาน'],
    ['on_route', 'กำลังส่ง'],
    ['waiting', 'รอออกรถ'],
    ['done', 'ส่งครบวันนี้'],
]

// แผนที่รวม: Admin เลือกเที่ยวเพื่อดูเส้นทาง / ผู้บริหารดูอย่างเดียว
export default function LiveMap({ readOnly }) {
    const { id } = useParams()
    const navigate = useNavigate()
    const base = readOnly ? '/exec/trips' : '/admin/trips'
    const list = useApi('/trips')
    const branches = useApi('/branches')
    const stock = useApi('/warehouse/stock')
    const pending = useApi('/requests?status=pending')
    const vehicles = useApi('/vehicles')
    const [trip, setTrip] = useState(null)
    const [trucks, setTrucks] = useState({}) // tripId → ตำแหน่งล่าสุด
    const [q, setQ] = useState('')
    const [status, setStatus] = useState('active')

    const active = useMemo(() => (list.data || []).filter((t) => ACTIVE.includes(t.status)), [list.data])
    const selectedId = Number(id) || active.find((t) => t.status === 'on_route')?.id || active[0]?.id || list.data?.[0]?.id

    const loadTrip = useCallback(() => {
        if (selectedId) api.get(`/trips/${selectedId}`).then((r) => setTrip(r.data)).catch(() => setTrip(null))
        else setTrip(null)
    }, [selectedId])
    useEffect(() => {
        loadTrip()
    }, [loadTrip])

    useEffect(() => {
        if (!list.data) return
        setTrucks((prev) => {
            const next = { ...prev }
            for (const t of list.data) if (t.status === 'on_route' && t.lastLocation && !next[t.id]) next[t.id] = { tripId: t.id, code: t.code, driverName: t.driverName, ...t.lastLocation }
            return next
        })
    }, [list.data])

    const reloadList = list.reload
    const reloadOthers = useCallback(() => {
        stock.reload()
        pending.reload()
        vehicles.reload()
        branches.reload()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stock.reload, pending.reload, vehicles.reload, branches.reload])
    useSocket('trip_changed', useCallback(() => { reloadList(); loadTrip(); reloadOthers() }, [reloadList, loadTrip, reloadOthers]))
    useSocket('requests_changed', reloadOthers)
    useSocket('stock_changed', useCallback(() => branches.reload(), [branches]))
    useSocket('truck_location', useCallback((p) => setTrucks((prev) => ({ ...prev, [p.tripId]: { ...prev[p.tripId], ...p } })), []))

    if (list.loading || branches.loading) return <Loading />
    if (list.error) return <ErrorBox>{list.error}</ErrorBox>

    const all = list.data
    const ql = q.trim().toLowerCase()
    const visible = all.filter((t) => {
        const okStatus = status === 'active' ? ACTIVE.includes(t.status) : status === 'on_route' ? t.status === 'on_route' : status === 'waiting' ? ['assigned', 'accepted'].includes(t.status) : t.status === 'completed'
        return okStatus && (!ql || [t.code, t.driverName, t.plate, ...t.stopNames].join(' ').toLowerCase().includes(ql))
    })
    const onRoute = all.filter((t) => t.status === 'on_route')
    const others = Object.values(trucks).filter((t) => t.tripId !== trip?.id && onRoute.some((a) => a.id === t.tripId) && visible.some((v) => v.id === t.tripId)).map((t) => ({ ...t, active: true }))
    const bs = branches.data || []
    const lowBranches = bs.filter((b) => !b.isWarehouse && b.lowItems > 0 && !b.outItems).length
    const outBranches = bs.filter((b) => b.outItems > 0).length
    const next = trip?.stops.find((s) => s.status === 'pending')
    const done = trip ? trip.stops.filter((s) => s.status !== 'pending').length : 0

    return (
        <>
            <TripMap trip={trip} truck={trip && trucks[trip.id]} trucks={others} branches={bs} labels className="h-[460px] md:h-[540px]">
                <div className="absolute inset-x-4 top-4 z-[500] flex flex-wrap gap-2.5">
                    <SearchInput value={q} onChange={setQ} placeholder="ค้นหาสาขา คนขับ หรือทะเบียนรถ" className="min-w-[200px] flex-1 border-0 shadow-sm" />
                    <label className="flex h-11 items-center gap-1.5 rounded-[14px] bg-white px-3.5 text-sm shadow-sm">
                        <span className="text-muted">สถานะ</span>
                        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-transparent font-semibold outline-none">
                            {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                    </label>
                    {!readOnly && <Button onClick={() => navigate('/admin/planner')}>+ สร้างเที่ยวส่ง</Button>}
                </div>

                {trip && (
                    <div className="absolute top-[76px] right-4 z-[500] hidden gap-2 md:flex">
                        {[
                            [trip.code, 'เที่ยวส่ง'],
                            [next?.eta ? time(next.eta) : trip.status === 'completed' ? 'ครบ' : '–', 'ถึงจุดถัดไป'],
                            [`${done}/${trip.stopCount}`, 'จุดส่ง'],
                        ].map(([v, l]) => (
                            <div key={l} className="rounded-[18px] bg-ink px-5 py-3.5 text-center text-white">
                                <div className="text-[22px] font-semibold">{v}</div>
                                <div className="text-[11px] text-[#b9beb7]">{l}</div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="absolute bottom-4 left-4 z-[500] flex flex-wrap gap-x-4 gap-y-1 rounded-[14px] bg-white px-4 py-2.5 text-xs shadow-sm">
                    <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-brand" />กำลังส่ง {onRoute.length}</span>
                    <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-ink" />รอออกรถ {all.filter((t) => ['assigned', 'accepted'].includes(t.status)).length}</span>
                    <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-warn" />ใกล้หมด {lowBranches} สาขา</span>
                    <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-danger" />หมด {outBranches} สาขา</span>
                </div>
            </TripMap>

            <div className="grid gap-4 xl:grid-cols-[380px_1fr_300px]">
                <TripCard trip={trip} trips={visible} selectedId={selectedId} onSelect={(tid) => navigate(`${base}/${tid}`)} />
                <DemandCard stock={stock.data} pending={pending.data} lowBranches={lowBranches} readOnly={readOnly} />
                <FleetCard vehicles={vehicles.data} />
            </div>
        </>
    )
}

function TripCard({ trip, trips, selectedId, onSelect }) {
    if (!trip) return <Card><div className="mb-2 text-lg font-semibold">เที่ยวส่ง</div><Empty>ยังไม่มีเที่ยวส่ง</Empty></Card>
    const steps = [
        { label: trip.origin.name, time: trip.startedAt ? `ออก ${time(trip.startedAt)}` : 'รอออกรถ', state: trip.startedAt ? 'done' : 'now' },
        ...trip.stops.map((s, i) => {
            const prevDone = i === 0 ? !!trip.startedAt : trip.stops[i - 1].status !== 'pending'
            return {
                label: `สาขา${s.branchName}`,
                time: s.status === 'received' ? `รับครบ ${time(s.receivedAt)}` : s.status === 'arrived' ? `ถึง ${time(s.arrivedAt)}` : s.eta ? `ETA ${time(s.eta)}` : '',
                tone: s.status === 'received' ? 'brand' : undefined,
                state: s.status !== 'pending' ? 'done' : prevDone && trip.status === 'on_route' ? 'now' : 'todo',
            }
        }),
    ]
    return (
        <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <select value={selectedId} onChange={(e) => onSelect(e.target.value)} className="-ml-1 min-w-0 truncate bg-transparent text-lg font-semibold outline-none">
                    {!trips.some((t) => t.id === trip.id) && <option value={trip.id}>เที่ยวส่ง {trip.code}</option>}
                    {trips.map((t) => <option key={t.id} value={t.id}>เที่ยวส่ง {t.code}</option>)}
                </select>
                <StatusBadge map={TRIP_STATUS} value={trip.status} />
            </div>
            <div className="flex items-center gap-3">
                <Avatar name={trip.driver.name} />
                <div className="min-w-0 flex-1">
                    <div className="font-semibold">{trip.driver.name}</div>
                    <div className="text-xs text-muted">{trip.vehicle.type} · {trip.vehicle.plate}</div>
                </div>
                {trip.driver.phone && <a href={`tel:${trip.driver.phone}`} aria-label="โทรหาคนขับ" className="grid size-10 place-items-center rounded-xl border border-line"><Phone size={18} /></a>}
            </div>
            <Timeline items={steps} />
        </Card>
    )
}

function DemandCard({ stock, pending, lowBranches, readOnly }) {
    const navigate = useNavigate()
    const rows = (stock || []).filter((p) => p.requested > 0).slice(0, 4)
    const urgent = (pending || []).filter((r) => r.priority === 'urgent').length
    return (
        <Card>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="text-lg font-semibold">คำขอเติมสินค้า</div>
                <div className="flex gap-1.5"><Badge tone="danger">ด่วน {urgent}</Badge><Badge tone="warn">ใกล้หมด {lowBranches}</Badge></div>
            </div>
            {rows.length === 0 && <Empty>ไม่มีคำขอรออนุมัติ</Empty>}
            {rows.map((p) => (
                <div key={p.productId} className="flex items-center gap-3 border-b border-[#f0f2ef] py-3 last:border-0">
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{p.name}</div>
                        <div className="text-xs text-muted">{p.sku} · {p.branches} สาขา · ขอรวม {num(p.requested)}</div>
                    </div>
                    {p.shortfall > 0 ? <Badge tone="danger">คลังเหลือ {num(p.available)}</Badge> : <Badge tone="brand">คลังพอ</Badge>}
                    {!readOnly &&
                        (p.shortfall > 0 ? (
                            <Button size="sm" onClick={() => navigate(`/admin/warehouse?product=${p.productId}`)}>จัดสรร</Button>
                        ) : (
                            <Button size="sm" variant="ghost" onClick={() => navigate('/admin/requests')}>อนุมัติ</Button>
                        ))}
                </div>
            ))}
        </Card>
    )
}

// เกจครึ่งวงกลม: สัดส่วนรถที่กำลังวิ่ง
function FleetCard({ vehicles }) {
    const v = vehicles || []
    const run = v.filter((x) => x.status === 'in_use').length
    const free = v.filter((x) => x.status === 'available').length
    const fix = v.filter((x) => x.status === 'maintenance').length
    const pct = v.length ? run / v.length : 0
    const R = 90
    const arc = Math.PI * R
    return (
        <Card className="flex flex-col">
            <div className="text-lg font-semibold">สถานะรถ</div>
            <div className="text-xs text-muted">รถทั้งหมด {v.length} คัน</div>
            <div className="relative mx-auto mt-4 w-[220px]">
                <svg viewBox="0 0 220 120" className="w-full">
                    <path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#eef0ed" strokeWidth="22" strokeLinecap="round" />
                    <path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#22a45d" strokeWidth="22" strokeLinecap="round" strokeDasharray={`${arc * pct} ${arc}`} />
                </svg>
                <div className="absolute inset-x-0 bottom-0 text-center">
                    <span className="text-[32px] font-semibold">{run}</span><span className="text-lg text-muted">/{v.length}</span>
                    <div className="text-xs text-muted">กำลังวิ่ง</div>
                </div>
            </div>
            <div className="mt-4 flex justify-between text-xs">
                <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-brand" />วิ่ง {run}</span>
                <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-ink" />ว่าง {free}</span>
                <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-[#cfd3cd]" />ซ่อม {fix}</span>
            </div>
        </Card>
    )
}
