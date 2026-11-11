import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Phone, Search, X } from 'lucide-react'
import api from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { TRIP_STATUS, num, time } from '../../lib/format'
import TripMap, { MAP_COLORS } from '../../components/TripMap'
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Loading, Select, StatusBadge, Timeline } from '../../components/ui'

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
    // ค้นหาแล้วพาแผนที่ไป: focus = คำสั่งให้แผนที่ (key ใหม่ = เล่นใหม่) · wantTrip = รอให้เที่ยวที่เลือกโหลดเสร็จก่อน
    const [focus, setFocus] = useState(null)
    const [wantTrip, setWantTrip] = useState(null)

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
        if (wantTrip && trip?.id === wantTrip) {
            setFocus({ key: Date.now() })
            setWantTrip(null)
        }
    }, [trip, wantTrip])

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
            {/* fitPad: เว้นที่ด้านบนให้แถบค้นหา และด้านล่างให้คำอธิบายสี หมุดจะได้ไม่ถูกบัง */}
            <TripMap trip={trip} truck={trip && trucks[trip.id]} trucks={others} branches={bs} labels fitPad={[120, 80]} focus={focus} className="h-[460px] md:h-[540px]">
                <div className="absolute inset-x-4 top-4 z-[500] flex flex-wrap gap-2.5">
                    <MapSearch
                        value={q}
                        onChange={setQ}
                        trips={all}
                        branches={bs.filter((b) => !b.isWarehouse)}
                        onPickTrip={(t) => {
                            setWantTrip(t.id)
                            if (t.id !== selectedId) navigate(`${base}/${t.id}`)
                        }}
                        onPickBranch={(b) => setFocus({ lat: b.lat, lng: b.lng, key: Date.now() })}
                    />
                    <span className="ml-auto" />
                    <Select variant="pill" label="สถานะ" value={status} onChange={setStatus} options={FILTERS} align="right" />
                    {!readOnly && <Button onClick={() => navigate('/admin/planner')}>+ สร้างเที่ยวส่ง</Button>}
                </div>

                {trip && (
                    <div className="absolute top-[76px] right-4 z-[500] hidden gap-2 md:flex">
                        {[
                            [trip.code, 'เที่ยวส่ง'],
                            [next?.eta ? time(next.eta) : trip.status === 'completed' ? 'ครบ' : '–', 'ถึงจุดถัดไป'],
                            [`${done}/${trip.stopCount}`, 'จุดส่ง'],
                        ].map(([v, l]) => (
                            <div key={l} className="rounded-[14px] bg-ink px-4 py-2.5 text-center text-white">
                                <div className="text-lg leading-tight font-semibold">{v}</div>
                                <div className="text-[10px] text-[#b9beb7]">{l}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* คำอธิบายสี 2 กลุ่ม: เที่ยวส่ง (เส้น = เส้นทาง) / สต็อกสาขา (จุด = หมุดสาขา) — สีตรงกับ MAP_COLORS ใน TripMap */}
                <div className="absolute bottom-4 left-4 z-[500] flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[14px] bg-white px-4 py-2.5 text-xs shadow-sm">
                    <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                        <b className="font-semibold text-muted">เที่ยวส่ง</b>
                        <span className="flex items-center gap-1.5"><i className="h-1 w-4 rounded-full" style={{ background: MAP_COLORS.onRoute }} />กำลังส่ง {onRoute.length}</span>
                        <span className="flex items-center gap-1.5"><i className="h-1 w-4 rounded-full" style={{ background: MAP_COLORS.waiting }} />รอออกรถ {all.filter((t) => ['assigned', 'accepted'].includes(t.status)).length}</span>
                        <span className="flex items-center gap-1.5"><i className="h-1 w-4 rounded-full" style={{ background: MAP_COLORS.done }} />ส่งครบ {all.filter((t) => t.status === 'completed').length}</span>
                    </span>
                    <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
                    <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                        <b className="font-semibold text-muted">สต็อกสาขา</b>
                        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full" style={{ background: MAP_COLORS.low }} />ใกล้หมด {lowBranches}</span>
                        <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full" style={{ background: MAP_COLORS.out }} />หมด {outBranches}</span>
                    </span>
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

// ช่องค้นหาบนแผนที่: ปกติหดเป็นปุ่มแว่นขยายริมซ้าย กดแล้วค่อยกางออก
// หดกลับเมื่อคลิกที่อื่นตอนช่องว่าง หรือกด Esc (ล้างคำค้นด้วย) · มีคำค้นอยู่จะกางค้างไว้
// พิมพ์แล้วขึ้นรายการผลลัพธ์ (เที่ยวส่ง / สาขา) เลือกแล้วแผนที่พาไปที่นั่น
function MapSearch({ value, onChange, trips = [], branches = [], onPickTrip, onPickBranch }) {
    const [open, setOpen] = useState(!!value)
    const [focused, setFocused] = useState(false)
    const [active, setActive] = useState(0)
    const input = useRef(null)
    const expanded = open || !!value
    const ql = value.trim().toLowerCase()
    const results = useMemo(() => {
        if (!ql) return []
        const tr = trips
            .filter((t) => [t.code, t.driverName, t.plate, ...t.stopNames].join(' ').toLowerCase().includes(ql))
            .slice(0, 5)
            .map((t) => ({ kind: 'trip', key: `t${t.id}`, item: t }))
        const br = branches
            .filter((b) => `${b.name} ${b.code}`.toLowerCase().includes(ql))
            .slice(0, 5)
            .map((b) => ({ kind: 'branch', key: `b${b.id}`, item: b }))
        return [...tr, ...br]
    }, [ql, trips, branches])
    const showResults = focused && ql && expanded
    const pick = (r) => {
        if (!r) return
        if (r.kind === 'trip') onPickTrip?.(r.item)
        else onPickBranch?.(r.item)
        setFocused(false)
        input.current?.blur()
    }
    const expand = () => {
        setOpen(true)
        requestAnimationFrame(() => input.current?.focus())
    }
    const collapse = () => {
        onChange('')
        setOpen(false)
        input.current?.blur()
    }
    return (
        <div className="relative min-w-0 flex-1 transition-[max-width] duration-300 ease-[var(--ease-out)]" style={{ maxWidth: expanded ? '100%' : 44 }}>
            <div className={`flex h-11 items-center overflow-hidden rounded-[14px] bg-white text-sm shadow-sm transition-shadow ${expanded ? 'focus-within:shadow-[0_0_0_4px_rgba(20,22,20,0.08)]' : 'hover:bg-soft'}`}>
                <button
                    type="button"
                    aria-label="ค้นหาสาขา คนขับ หรือทะเบียนรถ"
                    aria-expanded={expanded}
                    onClick={() => (expanded ? input.current?.focus() : expand())}
                    className="grid size-11 shrink-0 place-items-center text-[#9aa097] hover:text-ink"
                >
                    <Search size={17} />
                </button>
                <input
                    ref={input}
                    value={value}
                    tabIndex={expanded ? 0 : -1}
                    role="combobox"
                    aria-expanded={!!showResults}
                    aria-controls="map-search-results"
                    aria-activedescendant={showResults && results[active] ? `msr-${results[active].key}` : undefined}
                    onChange={(e) => {
                        onChange(e.target.value)
                        setActive(0)
                        setFocused(true)
                    }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                        setFocused(false)
                        if (!value) setOpen(false)
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') return collapse()
                        if (!showResults) return
                        if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            setActive((a) => Math.min(results.length - 1, a + 1))
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            setActive((a) => Math.max(0, a - 1))
                        } else if (e.key === 'Enter') {
                            e.preventDefault()
                            pick(results[active])
                        }
                    }}
                    placeholder="ค้นหาสาขา คนขับ หรือทะเบียนรถ"
                    className="min-w-0 flex-1 bg-transparent pr-3 outline-none placeholder:text-faint"
                />
                {value && (
                    <button type="button" aria-label="ล้างคำค้น" onClick={collapse} className="mr-2 grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-soft">
                        <X size={15} />
                    </button>
                )}
            </div>

            {showResults && (
                <div id="map-search-results" role="listbox" className="bl-pop absolute inset-x-0 top-[calc(100%+6px)] max-w-[440px] overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-[0_12px_32px_rgba(20,22,20,0.14)]">
                    {results.length === 0 && <div className="px-3 py-3 text-center text-sm text-muted">ไม่พบเที่ยวหรือสาขาที่ตรงกับ “{value}”</div>}
                    {results.map((r, i) => {
                        const first = i === 0 || results[i - 1].kind !== r.kind
                        const t = r.item
                        return (
                            <div key={r.key}>
                                {first && <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-faint">{r.kind === 'trip' ? 'เที่ยวส่ง' : 'สาขา'}</div>}
                                <div
                                    id={`msr-${r.key}`}
                                    role="option"
                                    aria-selected={i === active}
                                    onMouseEnter={() => setActive(i)}
                                    onMouseDown={(e) => e.preventDefault()} // ไม่ให้ช่องค้นหาเสียโฟกัสก่อนเลือก
                                    onClick={() => pick(r)}
                                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ${i === active ? 'bg-soft' : ''}`}
                                >
                                    {r.kind === 'trip' ? (
                                        <>
                                            <span className="min-w-0">
                                                <span className="font-semibold">{t.code}</span>
                                                <span className="block truncate text-xs text-muted">{t.driverName} · {t.plate} · {t.stopNames.join(' → ')}</span>
                                            </span>
                                            <StatusBadge map={TRIP_STATUS} value={t.status} />
                                        </>
                                    ) : (
                                        <>
                                            <span className="min-w-0">
                                                <span className="font-semibold">สาขา{t.name}</span>
                                                <span className="block truncate text-xs text-muted">{t.code} · {t.region}</span>
                                            </span>
                                            {t.outItems > 0 ? <Badge tone="danger">หมด {t.outItems}</Badge> : t.lowItems > 0 ? <Badge tone="warn">ใกล้หมด {t.lowItems}</Badge> : <Badge tone="brand">ปกติ</Badge>}
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
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
                <Select
                    variant="ghost"
                    ariaLabel={`เลือกเที่ยวส่ง (ตอนนี้ ${trip.code})`}
                    value={selectedId}
                    onChange={onSelect}
                    options={[
                        ...(trips.some((t) => t.id === trip.id) ? [] : [{ value: trip.id, label: `เที่ยวส่ง ${trip.code}`, hint: TRIP_STATUS[trip.status]?.[0] }]),
                        ...trips.map((t) => ({ value: t.id, label: `เที่ยวส่ง ${t.code}`, hint: TRIP_STATUS[t.status]?.[0] })),
                    ]}
                />
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
    const ARC = 'M20 110 A90 90 0 0 1 200 110'
    return (
        <Card className="flex flex-col">
            <div className="text-lg font-semibold">สถานะรถ</div>
            <div className="text-xs text-muted">รถทั้งหมด {v.length} คัน</div>
            <div className="relative mx-auto mt-4 w-[220px]">
                <svg viewBox="-6 -6 232 132" className="w-full" role="img" aria-label={`รถกำลังวิ่ง ${run} จาก ${v.length} คัน`}>
                    {/* ขอบนอกแบบเดียวกับจุดไทม์ไลน์: เส้นเทาอ่อน → ช่องขาว → แถบเกจ (วาดเส้นใหญ่ซ้อนกัน ปลายมนจึงมีขอบด้วย) */}
                    <path className="bl-gauge-ring" pathLength="1" d={ARC} fill="none" stroke="var(--color-line)" strokeWidth="29" strokeLinecap="round" />
                    <path d={ARC} fill="none" stroke="#fff" strokeWidth="26" strokeLinecap="round" />
                    <path d={ARC} fill="none" stroke="#eef0ed" strokeWidth="22" strokeLinecap="round" />
                    <path className="bl-gauge" d={ARC} fill="none" stroke="#22a45d" strokeWidth="22" strokeLinecap="round" strokeDasharray={`${arc * pct} ${arc}`} />
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
