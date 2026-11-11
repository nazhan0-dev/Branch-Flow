import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { LogOut, Navigation, Truck } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useAuth } from '../../store/auth'
import { useApi } from '../../lib/useApi'
import { disconnectSocket, useSocket } from '../../lib/socket'
import { TRIP_STATUS, dateTime, longDate, time } from '../../lib/format'
import { estimateEtas, fmtKm, roadKm } from '../../lib/geo'
import NotificationBell from '../../components/NotificationBell'
import { Avatar, Badge, Button, Empty, ErrorBox, Loading, Num, StatusBadge } from '../../components/ui'

const ACTIVE = ['assigned', 'accepted', 'on_route']
const firstName = (n) => n.split(' ')[0]

const useTrips = () => {
    const api_ = useApi('/trips')
    const reload = api_.reload
    useSocket('trip_changed', useCallback(() => reload(), [reload]))
    useSocket('notification', useCallback(() => reload(), [reload]))
    return api_
}

const Header = ({ user, small }) => (
    <div className="flex items-start justify-between px-5 pt-6 pb-3">
        <div>
            <div className="text-[13px] text-muted">{small}</div>
            <h1 className="text-[28px] font-semibold">สวัสดี {firstName(user.name)}</h1>
        </div>
        <div className="flex items-center gap-2">
            <NotificationBell variant="plain" />
            <Avatar name={user.name} />
        </div>
    </div>
)

export default function DriverJobs() {
    const user = useAuth((s) => s.user)
    const navigate = useNavigate()
    const { data, error, loading } = useTrips()
    const [cur, setCur] = useState(null)
    const [busy, setBusy] = useState(null)
    const [err, setErr] = useState('')

    const current = (data || []).find((t) => t.status === 'on_route') || (data || []).find((t) => t.status === 'accepted')
    const queued = (data || []).filter((t) => t.status === 'assigned' || (t.status === 'accepted' && t.id !== current?.id))

    useEffect(() => {
        if (!current) return setCur(null)
        api.get(`/trips/${current.id}`).then((r) => setCur(r.data)).catch(() => setCur(null))
    }, [current?.id, current?.arrivedCount, current?.status]) // eslint-disable-line react-hooks/exhaustive-deps

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>

    const accept = async (id) => {
        setBusy(id)
        setErr('')
        try {
            await api.post(`/trips/${id}/accept`)
            navigate(`/driver/trips/${id}`)
        } catch (e) {
            setErr(errMsg(e))
            setBusy(null)
        }
    }

    const vehicleTrip = cur || null
    const next = cur?.stops.find((s) => s.status === 'pending')
    const totalKm = cur ? estimateEtas(cur.origin, cur.stops).totalKm : 0
    const nextKm = next ? roadKm(cur.lastLocation?.lat != null ? cur.lastLocation : cur.origin, next) : 0

    return (
        <>
            <Header user={user} small={longDate()} />
            <div className="flex flex-col gap-5 px-5">
                <div className="flex items-center gap-3.5 rounded-[20px] bg-white p-4">
                    <span className="grid size-10 place-items-center rounded-xl bg-soft"><Truck size={20} /></span>
                    <div className="min-w-0 flex-1">
                        <div className="font-semibold">{vehicleTrip ? vehicleTrip.vehicle.plate : 'ยังไม่มีรถที่ใช้งาน'}</div>
                        <div className="text-xs text-muted">{vehicleTrip ? `${vehicleTrip.vehicle.type} · ${vehicleTrip.origin.name}` : 'รถจะผูกกับเที่ยวส่งที่คลังมอบหมาย'}</div>
                    </div>
                    <Badge tone={cur?.status === 'on_route' ? 'brand' : 'neutral'}>● {cur?.status === 'on_route' ? 'กำลังส่ง' : 'พร้อมงาน'}</Badge>
                </div>

                <section>
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-lg font-semibold">งานที่กำลังทำ</h2>
                        <span className="text-xs text-muted">{current ? '1 เที่ยว' : '–'}</span>
                    </div>
                    {!cur ? (
                        <Empty>ยังไม่มีงานที่กำลังทำ · กดรับงานจากรายการด้านล่าง</Empty>
                    ) : (
                        <div className="flex flex-col gap-4 rounded-[22px] bg-white p-[18px]">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="font-semibold">เที่ยวส่ง {cur.code}</div>
                                    <div className="text-xs text-muted">{cur.stopCount} จุด · {fmtKm(totalKm)} · {cur.startedAt ? `ออก ${time(cur.startedAt)}` : 'ยังไม่ออกเดินทาง'}</div>
                                </div>
                                <StatusBadge map={TRIP_STATUS} value={cur.status} />
                            </div>
                            <div className="flex gap-1.5">
                                {cur.stops.map((s) => (
                                    <span key={s.id} className={`h-1.5 flex-1 rounded-full ${s.status !== 'pending' ? 'bg-brand' : s.id === next?.id ? 'bg-brand-soft' : 'bg-[#eef0ed]'}`} />
                                ))}
                            </div>
                            {next ? (
                                <div className="flex items-center gap-3 rounded-2xl bg-soft p-3.5">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs text-muted">จุดถัดไป</div>
                                        <div className="font-semibold">สาขา{next.branchName}</div>
                                        <div className="text-xs text-muted">{fmtKm(nextKm)}{next.eta ? ` · ถึงประมาณ ${time(next.eta)}` : ''}</div>
                                    </div>
                                    <Num n={next.seq} />
                                </div>
                            ) : (
                                <div className="rounded-2xl bg-soft p-3.5 text-sm">ส่งครบทุกจุดแล้ว รอสาขายืนยันรับของ</div>
                            )}
                            <Button variant="brand" size="lg" onClick={() => navigate(`/driver/trips/${cur.id}`)}>
                                <Navigation size={18} /> {cur.status === 'on_route' ? 'นำทางต่อ' : 'เปิดงานและออกเดินทาง'}
                            </Button>
                        </div>
                    )}
                </section>

                <section>
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-lg font-semibold">งานถัดไป</h2>
                        <span className="text-xs text-muted">มอบหมายโดยคลังกลาง</span>
                    </div>
                    <ErrorBox>{err}</ErrorBox>
                    {queued.length === 0 && <Empty>ยังไม่มีงานใหม่ · ระบบจะแจ้งเตือนเมื่อคลังมอบงาน</Empty>}
                    <div className="flex flex-col gap-3">
                        {queued.map((t) => (
                            <div key={t.id} className="flex flex-col gap-3 rounded-[22px] bg-white p-[18px]">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="font-semibold">เที่ยวส่ง {t.code}</div>
                                        <div className="text-xs text-muted">{t.stopCount} จุด · {t.plate} · มอบหมาย {time(t.createdAt)}</div>
                                    </div>
                                    <StatusBadge map={TRIP_STATUS} value={t.status} />
                                </div>
                                <div className="text-xs text-muted">{t.stopNames.join(' → ')}</div>
                                <div className="grid grid-cols-2 gap-2.5">
                                    <Button variant="ghost" onClick={() => navigate(`/driver/trips/${t.id}`)}>ดูรายละเอียด</Button>
                                    {t.status === 'assigned' ? (
                                        <Button loading={busy === t.id} onClick={() => accept(t.id)}>รับงาน</Button>
                                    ) : (
                                        <Button onClick={() => navigate(`/driver/trips/${t.id}`)}>เปิดงาน</Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </>
    )
}

// แท็บ "แผนที่" → เปิดงานที่กำลังทำ
export function DriverMap() {
    const { data, loading } = useTrips()
    if (loading) return <Loading />
    const t = (data || []).find((x) => x.status === 'on_route') || (data || []).find((x) => ACTIVE.includes(x.status))
    if (t) return <Navigate to={`/driver/trips/${t.id}`} replace />
    return (
        <div className="p-5">
            <h1 className="mb-4 text-[28px] font-semibold">แผนที่</h1>
            <Empty>ยังไม่มีงานที่กำลังทำ</Empty>
        </div>
    )
}

export function DriverHistory() {
    const navigate = useNavigate()
    const { data, loading, error } = useTrips()
    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>
    const done = data.filter((t) => !ACTIVE.includes(t.status))
    return (
        <div className="flex flex-col gap-3 p-5">
            <h1 className="text-[28px] font-semibold">ประวัติงาน</h1>
            {done.length === 0 && <Empty>ยังไม่มีงานที่ส่งเสร็จ</Empty>}
            {done.map((t) => (
                <button key={t.id} onClick={() => navigate(`/driver/trips/${t.id}`)} className="flex items-center justify-between rounded-[20px] bg-white p-4 text-left">
                    <div>
                        <div className="font-semibold">เที่ยวส่ง {t.code}</div>
                        <div className="text-xs text-muted">{t.stopCount} จุด · {t.stopNames.join(', ')}</div>
                        <div className="text-xs text-faint">{dateTime(t.finishedAt || t.createdAt)}</div>
                    </div>
                    <StatusBadge map={TRIP_STATUS} value={t.status} />
                </button>
            ))}
        </div>
    )
}

export function DriverProfile() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()
    return (
        <div className="flex flex-col gap-4 p-5">
            <h1 className="text-[28px] font-semibold">โปรไฟล์</h1>
            <div className="flex items-center gap-3.5 rounded-[22px] bg-white p-4">
                <Avatar name={user.name} size={52} />
                <div>
                    <div className="font-semibold">{user.name}</div>
                    <div className="text-xs text-muted">คนขับ · {user.email}</div>
                </div>
            </div>
            <Button
                variant="ghost"
                size="lg"
                onClick={async () => {
                    disconnectSocket()
                    await logout()
                    navigate('/login', { replace: true })
                }}
            >
                <LogOut size={18} /> ออกจากระบบ
            </Button>
        </div>
    )
}
