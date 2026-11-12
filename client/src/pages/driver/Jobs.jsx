import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Check, ChevronRight, ClipboardList, Clock, LogOut, Mail, MapPin, Navigation, Package, Truck } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useAuth } from '../../store/auth'
import { useApi } from '../../lib/useApi'
import { disconnectSocket, useSocket } from '../../lib/socket'
import { TRIP_STATUS, isToday, longDate, time } from '../../lib/format'
import { estimateEtas, fmtKm, roadKm } from '../../lib/geo'
import NotificationBell from '../../components/NotificationBell'
import { Avatar, Button, ErrorBox, Loading, StatusBadge } from '../../components/ui'

const ACTIVE = ['assigned', 'accepted', 'on_route']
const firstName = (n) => n.split(' ')[0]

const useTrips = () => {
    const api_ = useApi('/trips')
    const reload = api_.reload
    useSocket('trip_changed', useCallback(() => reload(), [reload]))
    useSocket('notification', useCallback(() => reload(), [reload]))
    return api_
}

// การ์ดพื้นขาวของหน้าคนขับ (เงาบาง ๆ แยกจากพื้นหลัง)
const Panel = ({ className = '', children, ...rest }) => (
    <div className={`rounded-[22px] bg-white shadow-card ${className}`} {...rest}>
        {children}
    </div>
)

// ไม่มีข้อมูล: ไอคอนในวงกลม + หัวข้อ + คำอธิบาย
const EmptyState = ({ icon: Icon, title, children }) => (
    <Panel className="bl-fade flex flex-col items-center px-6 py-8 text-center">
        <span className="mb-3 grid size-12 place-items-center rounded-full bg-soft text-faint"><Icon size={22} /></span>
        <div className="font-semibold">{title}</div>
        {children && <div className="mt-1 text-xs text-muted">{children}</div>}
    </Panel>
)

const SectionHead = ({ title, aside }) => (
    <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
    </div>
)

// เส้นทางแบบย่อ: จุดแรก → … → จุดสุดท้าย (เกิน 3 จุดยุบตรงกลาง)
const Route = ({ names }) => {
    const shown = names.length > 3 ? [names[0], `+${names.length - 2} จุด`, names.at(-1)] : names
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
            {shown.map((n, i) => (
                <span key={`${n}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <ChevronRight size={13} className="text-faint" />}
                    <span className={names.length > 3 && i === 1 ? 'text-muted' : 'font-medium'}>{n}</span>
                </span>
            ))}
        </div>
    )
}

export default function DriverJobs() {
    const user = useAuth((s) => s.user)
    const navigate = useNavigate()
    const { data, error, loading } = useTrips()
    const [cur, setCur] = useState(null)
    const [busy, setBusy] = useState(null)
    const [err, setErr] = useState('')

    const trips = data || []
    const current = trips.find((t) => t.status === 'on_route') || trips.find((t) => t.status === 'accepted')
    const queued = trips.filter((t) => t.status === 'assigned' || (t.status === 'accepted' && t.id !== current?.id))
    const doneToday = trips.filter((t) => t.status === 'completed' && isToday(t.finishedAt))

    useEffect(() => {
        if (!current) return setCur(null)
        api.get(`/trips/${current.id}`).then((r) => setCur(r.data)).catch(() => setCur(null))
    }, [current?.id, current?.arrivedCount, current?.status]) // eslint-disable-line react-hooks/exhaustive-deps

    if (loading) return <Loading />
    if (error) return <div className="p-5"><ErrorBox>{error}</ErrorBox></div>

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

    const next = cur?.stops.find((s) => s.status === 'pending')
    const doneStops = cur ? cur.stops.filter((s) => s.status !== 'pending').length : 0
    const totalKm = cur ? estimateEtas(cur.origin, cur.stops).totalKm : 0
    const nextKm = next ? roadKm(cur.lastLocation?.lat != null ? cur.lastLocation : cur.origin, next) : 0

    return (
        <div className="flex flex-col gap-6 px-5 pt-6 pb-4">
            {/* หัวหน้า */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-[13px] text-muted">{longDate()}</div>
                    <h1 className="text-[28px] leading-tight font-semibold">สวัสดี {firstName(user.name)}</h1>
                </div>
                <div className="flex items-center gap-2">
                    <NotificationBell variant="plain" />
                    <button onClick={() => navigate('/driver/profile')} aria-label="โปรไฟล์" className="rounded-full">
                        <Avatar name={user.name} />
                    </button>
                </div>
            </div>

            {/* ตัวเลขวันนี้ */}
            <Panel className="grid grid-cols-3 divide-x divide-[#f0f2ef] py-3.5">
                {[
                    [current ? 1 : 0, 'กำลังทำ'],
                    [queued.length, 'งานรอ'],
                    [doneToday.length, 'ส่งครบวันนี้'],
                ].map(([v, l]) => (
                    <div key={l} className="text-center">
                        <div className="text-[22px] leading-tight font-semibold tabular-nums">{v}</div>
                        <div className="text-[11px] text-muted">{l}</div>
                    </div>
                ))}
            </Panel>

            {/* งานที่กำลังทำ */}
            <section>
                <SectionHead title="งานที่กำลังทำ" />
                {!cur ? (
                    <EmptyState icon={Truck} title="ยังไม่มีงานที่กำลังทำ">กดรับงานจากรายการด้านล่างเพื่อเริ่มงาน</EmptyState>
                ) : (
                    <Panel className="bl-rise flex flex-col gap-4 p-5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-xs text-muted">เที่ยวส่ง</div>
                                <div className="text-[22px] leading-tight font-semibold">{cur.code}</div>
                                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                                    <Truck size={13} /> {cur.vehicle.plate} · {cur.vehicle.type}
                                </div>
                            </div>
                            <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cur.status === 'on_route' ? 'bg-brand-soft text-brand-ink' : 'bg-soft text-muted'}`}>
                                {cur.status === 'on_route' && <i className="size-1.5 animate-pulse rounded-full bg-brand" />}
                                {TRIP_STATUS[cur.status][0]}
                            </span>
                        </div>

                        {/* ความคืบหน้าแต่ละจุด */}
                        <div>
                            <div className="mb-1.5 flex justify-between text-[11px] text-muted">
                                <span>ส่งแล้ว {doneStops}/{cur.stopCount} จุด</span>
                                <span>รวม {fmtKm(totalKm)}{cur.startedAt ? ` · ออก ${time(cur.startedAt)}` : ''}</span>
                            </div>
                            {/* แต่ละช่องเติมสีจากซ้ายทีละช่อง */}
                            <div className="flex gap-1.5">
                                {cur.stops.map((s, i) => (
                                    <span key={s.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef0ed]">
                                        {(s.status !== 'pending' || s.id === next?.id) && (
                                            <span className={`bl-seg block h-full rounded-full ${s.status !== 'pending' ? 'bg-brand' : 'bg-brand-soft'}`} style={{ '--d': `${200 + i * 150}ms` }} />
                                        )}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {next ? (
                            <div className="bl-rise flex items-center gap-3 rounded-2xl bg-soft p-3.5" style={{ '--d': '250ms' }}>
                                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-ink shadow-sm"><MapPin size={19} /></span>
                                <div className="min-w-0 flex-1">
                                    <div className="text-[11px] text-muted">จุดถัดไป · {next.seq}/{cur.stopCount}</div>
                                    <div className="truncate font-semibold">สาขา{next.branchName}</div>
                                </div>
                                <div className="shrink-0 text-right">
                                    <div className="font-semibold tabular-nums">{fmtKm(nextKm)}</div>
                                    <div className="text-[11px] text-muted">{next.eta ? `ถึง ${time(next.eta)}` : 'ยังไม่ออกรถ'}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="bl-rise flex items-center gap-3 rounded-2xl bg-brand-soft p-3.5" style={{ '--d': '250ms' }}>
                                <span className="bl-check-pop grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white" style={{ '--d': '450ms' }}><Check size={20} strokeWidth={2.6} /></span>
                                <div className="min-w-0">
                                    <div className="font-semibold text-brand-ink">ส่งครบทุกจุดแล้ว</div>
                                    <div className="text-[11px] text-brand-ink/80">รอสาขานับและยืนยันรับของ</div>
                                </div>
                            </div>
                        )}

                        <Button variant="brand" size="lg" className="bl-rise" style={{ '--d': '380ms' }} onClick={() => navigate(`/driver/trips/${cur.id}`)}>
                            {next ? <Navigation size={18} /> : null}
                            {!next ? 'ดูเที่ยวส่ง' : cur.status === 'on_route' ? 'นำทางต่อ' : 'เปิดงานและออกเดินทาง'}
                        </Button>
                    </Panel>
                )}
            </section>

            {/* งานถัดไป */}
            <section>
                <SectionHead title="งานถัดไป" aside="มอบหมายโดยคลังกลาง" />
                <ErrorBox>{err}</ErrorBox>
                {queued.length === 0 ? (
                    <EmptyState icon={ClipboardList} title="ยังไม่มีงานใหม่">ระบบจะแจ้งเตือนเมื่อคลังมอบงานให้</EmptyState>
                ) : (
                    <div className="flex flex-col gap-3">
                        {queued.map((t) => (
                            <Panel key={t.id} className="bl-fade flex flex-col gap-3.5 p-[18px]">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="font-semibold">เที่ยวส่ง {t.code}</div>
                                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted"><Clock size={12} /> มอบหมาย {time(t.createdAt)}</div>
                                    </div>
                                    <StatusBadge map={TRIP_STATUS} value={t.status} />
                                </div>
                                <div className="rounded-2xl bg-soft px-3.5 py-3">
                                    <Route names={t.stopNames} />
                                    <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                                        <span className="flex items-center gap-1"><MapPin size={12} /> {t.stopCount} จุด</span>
                                        <span className="flex items-center gap-1"><Truck size={12} /> {t.plate}</span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2.5">
                                    <Button variant="ghost" onClick={() => navigate(`/driver/trips/${t.id}`)}>ดูรายละเอียด</Button>
                                    {t.status === 'assigned' ? (
                                        <Button loading={busy === t.id} onClick={() => accept(t.id)}>รับงาน</Button>
                                    ) : (
                                        <Button onClick={() => navigate(`/driver/trips/${t.id}`)}>เปิดงาน</Button>
                                    )}
                                </div>
                            </Panel>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}

// แท็บ "แผนที่" → เปิดงานที่กำลังทำ
export function DriverMap() {
    const { data, loading } = useTrips()
    if (loading) return <Loading />
    const t = (data || []).find((x) => x.status === 'on_route') || (data || []).find((x) => ACTIVE.includes(x.status))
    if (t) return <Navigate to={`/driver/trips/${t.id}`} replace />
    return (
        <div className="flex flex-col gap-5 px-5 pt-6">
            <h1 className="text-[28px] font-semibold">แผนที่</h1>
            <EmptyState icon={MapPin} title="ยังไม่มีงานที่กำลังทำ">แผนที่นำทางจะเปิดเมื่อรับงานแล้ว</EmptyState>
        </div>
    )
}

export function DriverHistory() {
    const navigate = useNavigate()
    const { data, loading, error } = useTrips()
    if (loading) return <Loading />
    if (error) return <div className="p-5"><ErrorBox>{error}</ErrorBox></div>
    const done = data.filter((t) => !ACTIVE.includes(t.status))
    const completed = done.filter((t) => t.status === 'completed')
    const stops = completed.reduce((s, t) => s + Number(t.stopCount), 0)
    // จัดกลุ่มตามวันที่ส่งเสร็จ
    const groups = done.reduce((g, t) => {
        const d = t.finishedAt || t.createdAt
        const key = isToday(d) ? 'วันนี้' : longDate(d)
        ;(g[key] ||= []).push(t)
        return g
    }, {})

    return (
        <div className="flex flex-col gap-5 px-5 pt-6 pb-4">
            <h1 className="text-[28px] font-semibold">ประวัติงาน</h1>
            <Panel className="grid grid-cols-2 divide-x divide-[#f0f2ef] py-3.5">
                {[
                    [completed.length, 'เที่ยวที่ส่งครบ'],
                    [stops, 'จุดส่งทั้งหมด'],
                ].map(([v, l]) => (
                    <div key={l} className="text-center">
                        <div className="text-[22px] leading-tight font-semibold tabular-nums">{v}</div>
                        <div className="text-[11px] text-muted">{l}</div>
                    </div>
                ))}
            </Panel>

            {done.length === 0 && <EmptyState icon={Clock} title="ยังไม่มีงานที่ส่งเสร็จ">เที่ยวที่ส่งครบแล้วจะแสดงที่นี่</EmptyState>}
            {Object.entries(groups).map(([day, list]) => (
                <section key={day}>
                    <div className="mb-2 px-1 text-xs font-semibold text-muted">{day}</div>
                    <div className="flex flex-col gap-2.5">
                        {list.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => navigate(`/driver/trips/${t.id}`)}
                                className="flex items-center gap-3.5 rounded-[20px] bg-white p-4 text-left shadow-card transition-transform active:scale-[0.99]"
                            >
                                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${t.status === 'completed' ? 'bg-brand-soft text-brand-ink' : 'bg-danger-soft text-danger-ink'}`}>
                                    {t.status === 'completed' ? <Check size={19} /> : <Package size={18} />}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold">{t.code}</span>
                                        {t.status !== 'completed' && <StatusBadge map={TRIP_STATUS} value={t.status} />}
                                    </div>
                                    <div className="truncate text-xs text-muted">{t.stopNames.join(' → ')}</div>
                                </div>
                                <div className="shrink-0 text-right">
                                    <div className="text-sm font-semibold tabular-nums">{time(t.finishedAt || t.createdAt)}</div>
                                    <div className="text-[11px] text-muted">{t.stopCount} จุด</div>
                                </div>
                                <ChevronRight size={16} className="shrink-0 text-faint" />
                            </button>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    )
}

export function DriverProfile() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()
    const { data } = useTrips()
    const trips = data || []
    const completed = trips.filter((t) => t.status === 'completed')
    const last = trips.find((t) => t.plate)

    return (
        <div className="flex flex-col gap-5 px-5 pt-6 pb-4">
            <h1 className="text-[28px] font-semibold">โปรไฟล์</h1>

            <Panel className="flex flex-col items-center px-5 pt-7 pb-5 text-center">
                <Avatar name={user.name} size={72} />
                <div className="mt-3 text-lg font-semibold">{user.name}</div>
                <span className="mt-1 rounded-full bg-soft px-2.5 py-0.5 text-xs text-muted">คนขับ</span>
                <div className="mt-5 grid w-full grid-cols-2 divide-x divide-[#f0f2ef] border-t border-[#f0f2ef] pt-4">
                    <div>
                        <div className="text-xl font-semibold tabular-nums">{completed.length}</div>
                        <div className="text-[11px] text-muted">เที่ยวที่ส่งครบ</div>
                    </div>
                    <div>
                        <div className="text-xl font-semibold tabular-nums">{completed.reduce((s, t) => s + Number(t.stopCount), 0)}</div>
                        <div className="text-[11px] text-muted">จุดส่ง</div>
                    </div>
                </div>
            </Panel>

            <Panel className="px-4">
                {[
                    [Mail, 'อีเมล', user.email],
                    [Truck, 'รถล่าสุด', last ? `${last.plate}${last.vehicleType ? ` · ${last.vehicleType}` : ''}` : '–'],
                ].map(([Icon, label, value]) => (
                    <div key={label} className="flex items-center gap-3 border-b border-[#f0f2ef] py-3.5 last:border-0">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft text-muted"><Icon size={17} /></span>
                        <span className="text-sm text-muted">{label}</span>
                        <span className="ml-auto truncate text-sm font-semibold">{value}</span>
                    </div>
                ))}
            </Panel>

            <Button
                variant="danger"
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
