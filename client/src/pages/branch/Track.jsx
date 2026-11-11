import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Phone } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useSocket } from '../../lib/socket'
import { useAuth } from '../../store/auth'
import { SOURCE, countdown, minutesUntil, time } from '../../lib/format'
import { fmtKm, roadKm } from '../../lib/geo'
import TripMap from '../../components/TripMap'
import { Avatar, Badge, Button, Empty, ErrorBox, Loading, PageHeader, Timeline } from '../../components/ui'

export default function Track() {
    const { id } = useParams()
    const navigate = useNavigate()
    const user = useAuth((s) => s.user)
    const [trip, setTrip] = useState(null)
    const [request, setRequest] = useState(null)
    const [truck, setTruck] = useState(null)
    const [open, setOpen] = useState(false)
    const [state, setState] = useState({ loading: true, error: '', none: false })

    const load = useCallback(async () => {
        try {
            let tripId = id
            // ไม่ระบุเที่ยว → เลือกเที่ยวที่กำลังมาสาขานี้
            if (!tripId) {
                const { data } = await api.get('/trips?active=1')
                if (!data.length) return setState({ loading: false, error: '', none: true })
                tripId = data[0].id
            }
            const { data } = await api.get(`/trips/${tripId}`)
            setTrip(data)
            if (data.stops[0]) api.get(`/requests/${data.stops[0].requestId}`).then((r) => setRequest(r.data)).catch(() => {})
            setState({ loading: false, error: '', none: false })
        } catch (e) {
            setState({ loading: false, error: errMsg(e), none: false })
        }
    }, [id])

    useEffect(() => {
        load()
    }, [load])
    useSocket('trip_changed', useCallback(() => load(), [load]))
    useSocket('truck_location', useCallback((p) => setTruck((cur) => (trip && p.tripId === trip.id ? p : cur)), [trip]))

    // หมุดสาขาตัวเองแสดงป้าย "สาขาของคุณ"
    const mapTrip = useMemo(() => trip && { ...trip, stops: trip.stops.map((s) => ({ ...s, branchName: 'สาขาของคุณ' })) }, [trip])

    if (state.loading) return <Loading />
    if (state.error) return <ErrorBox>{state.error}</ErrorBox>
    if (state.none)
        return (
            <>
                <PageHeader title="ติดตามรถ" sub="ตำแหน่งรถที่กำลังมาส่งของที่สาขา" />
                <Empty>ตอนนี้ไม่มีรถที่กำลังมาส่งสาขาคุณ · เมื่อคลังจัดรถแล้วจะแสดงที่นี่</Empty>
            </>
        )

    const stop = trip.stops[0]
    if (!stop) return <Empty>รับของจากเที่ยวนี้ครบแล้ว</Empty>
    const pos = truck || trip.lastLocation
    const km = roadKm(pos?.lat != null ? pos : trip.origin, stop)
    const left = stop.eta ? minutesUntil(stop.eta) : null
    const arrived = stop.status !== 'pending'

    const before = (trip.progress || []).filter((p) => p.seq < stop.seq)
    const steps = [
        { label: 'ออกจากคลังกลาง', time: trip.startedAt ? time(trip.startedAt) : 'รอออกรถ', state: trip.startedAt ? 'done' : 'now' },
        ...before.map((p) => ({ label: p.status === 'pending' ? `กำลังส่งจุดที่ ${p.seq}` : `ส่งจุดที่ ${p.seq} แล้ว`, time: time(p.receivedAt || p.arrivedAt || p.eta), state: p.status === 'pending' ? (trip.startedAt ? 'now' : 'todo') : 'done' })),
        { label: arrived ? 'ถึงสาขาคุณแล้ว' : 'กำลังมาสาขาคุณ', time: time(stop.arrivedAt || stop.eta), state: arrived ? 'done' : trip.startedAt && before.every((p) => p.status !== 'pending') ? 'now' : 'todo' },
    ]

    return (
        <div className="flex flex-col lg:grid lg:grid-cols-[1fr_420px] lg:gap-4">
            <TripMap trip={mapTrip} truck={pos} labels fitPad={[80, 60]} className="h-[46vh] lg:h-[calc(100dvh-40px)]" rounded="rounded-[22px]" zoomControl={false}>
                <button aria-label="ย้อนกลับ" onClick={() => navigate('/branch')} className="absolute top-4 left-4 z-[500] grid size-11 place-items-center rounded-[14px] bg-white shadow-sm"><ChevronLeft size={20} /></button>
            </TripMap>

            <div className="relative z-[510] -mt-6 flex flex-col gap-4 rounded-t-[28px] bg-white p-5 pb-24 lg:mt-0 lg:h-fit lg:rounded-[22px] lg:pb-5">
                <div className="mx-auto h-1.5 w-11 rounded-full bg-[#e3e6e1] lg:hidden" />
                <div>
                    <div className="text-xs text-muted">รถกำลังมาที่สาขา{user.name.split(' ').at(-1).replace(/^สาขา/, '')}</div>
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-[30px] font-semibold">{arrived ? 'ถึงแล้ว' : stop.eta ? `ถึง ${time(stop.eta)}` : 'รอออกรถ'}</div>
                        <Badge tone={arrived ? 'warn' : trip.status === 'on_route' ? 'brand' : 'neutral'}>{arrived ? 'รอนับของ' : trip.status === 'on_route' ? 'กำลังมา' : 'รอคนขับ'}</Badge>
                    </div>
                    <div className="text-xs text-brand-ink">{arrived ? `ถึงเมื่อ ${time(stop.arrivedAt)} · กรุณานับและยืนยันรับของ` : `${left != null ? `อีกประมาณ ${countdown(left)} · ` : ''}${fmtKm(km)}`}</div>
                </div>

                <div className="flex items-center gap-3 rounded-2xl bg-soft p-3">
                    <Avatar name={trip.driver.name} />
                    <div className="min-w-0 flex-1">
                        <div className="font-semibold">{trip.driver.name}</div>
                        <div className="text-xs text-muted">{trip.vehicle.plate} · เที่ยวส่ง {trip.code}</div>
                    </div>
                    {trip.driver.phone && <a href={`tel:${trip.driver.phone}`} aria-label="โทรหาคนขับ" className="grid size-10 place-items-center rounded-xl border border-line bg-white"><Phone size={18} /></a>}
                </div>

                <Timeline items={steps} />

                {arrived ? (
                    <Button variant="brand" size="lg" onClick={() => navigate(`/branch/receive/${stop.requestId}`)}>นับและรับของ</Button>
                ) : null}

                <div className="rounded-2xl bg-soft">
                    <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-3.5 text-left">
                        <span>
                            <span className="block text-sm font-semibold">ของที่จะได้รับ {stop.items.length} รายการ</span>
                            <span className="block text-xs text-muted">ตามคำขอ {stop.requestCode}{request ? ` · ${SOURCE[request.source]}` : ''}</span>
                        </span>
                        {open ? <ChevronDown size={18} /> : <span className="flex items-center text-sm font-semibold">ดู <ChevronRight size={16} /></span>}
                    </button>
                    {open && (
                        <div className="px-3.5 pb-3">
                            {stop.items.map((i) => (
                                <div key={i.sku} className="flex justify-between border-t border-[#e9ece7] py-2 text-sm"><span>{i.name}</span><b>{i.qty}</b></div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
