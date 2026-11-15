import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { num } from '../../lib/format'
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Kpi, Loading, Modal, Notice, PageHeader, Select, Table, Tabs } from '../../components/ui'
import { ConfirmModal, CredentialModal, EMAIL_RE, FIELD, Field, PasswordInput, PasswordModal, tempPassword } from '../../components/accounts'

const VEHICLE_STATUS = {
    available: ['พร้อมใช้', 'brand'],
    in_use: ['กำลังวิ่ง', 'dark'],
    maintenance: ['ซ่อม', 'warn'],
    retired: ['เลิกใช้', 'neutral'],
}
const TYPES = ['รถ 4 ล้อ', 'รถ 6 ล้อ', 'รถ 10 ล้อ', 'รถกระบะ']
// สถานะรถที่แสดงจริง: มอบงานแล้วแต่ยังไม่ออก ก็นับว่าติดงาน
const vehicleState = (v) => (v.trip && v.status === 'available' ? ['ติดงาน', 'dark'] : VEHICLE_STATUS[v.status] || [v.status, 'neutral'])

export default function Fleet() {
    const [params, setParams] = useSearchParams()
    const tab = params.get('tab') === 'drivers' ? 'drivers' : 'vehicles'
    const vehicles = useApi('/fleet/vehicles')
    const drivers = useApi('/fleet/drivers')
    const [modal, setModal] = useState(null) // 'vehicle' | 'driver' | { password: driver } | { confirm }
    const [notice, setNotice] = useState(null)
    const [err, setErr] = useState('')

    const rv = vehicles.reload
    const rd = drivers.reload
    const refresh = useCallback(() => {
        rv()
        rd()
    }, [rv, rd])
    useSocket('fleet_changed', refresh)
    useSocket('trip_changed', refresh)

    if (vehicles.loading || drivers.loading) return <Loading />
    if (vehicles.error || drivers.error) return <ErrorBox>{vehicles.error || drivers.error}</ErrorBox>
    const vs = vehicles.data
    const ds = drivers.data

    const run = async (fn, okText) => {
        setErr('')
        try {
            await fn()
            setNotice(okText)
            refresh()
        } catch (e) {
            setErr(errMsg(e))
        }
    }
    const setVehicleStatus = (v, status) => run(() => api.patch(`/fleet/vehicles/${v.id}`, { status }), `${v.plate} → ${VEHICLE_STATUS[status][0]}`)
    const setDriver = (d, body, okText) => run(() => api.patch(`/fleet/drivers/${d.id}`, body), okText)

    const usable = vs.filter((v) => v.status !== 'retired')
    const counts = {
        ready: usable.filter((v) => v.status === 'available' && !v.trip).length,
        busy: usable.filter((v) => v.trip).length,
        repair: usable.filter((v) => v.status === 'maintenance').length,
        drivers: ds.filter((d) => d.enabled).length,
    }
    const vehicleOptions = [{ value: '', label: 'ไม่มีรถประจำ' }, ...usable.map((v) => ({ value: v.id, label: v.plate, hint: v.type }))]

    return (
        <>
            <PageHeader
                title="รถและคนขับ"
                sub="จัดการรถขนส่งและบัญชีคนขับของคลังกลาง"
                actions={tab === 'vehicles' ? <Button onClick={() => setModal('vehicle')}>+ เพิ่มรถ</Button> : <Button onClick={() => setModal('driver')}>+ เพิ่มคนขับ</Button>}
            />
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi label="รถพร้อมใช้" value={counts.ready} sub={`จาก ${usable.length} คันที่ใช้งาน`} />
                <Kpi label="รถติดงาน" value={counts.busy} sub="มอบงานแล้ว / กำลังวิ่ง" />
                <Kpi label="รถซ่อม" value={counts.repair} sub="ไม่ถูกเลือกในหน้าจัดเที่ยว" badge={counts.repair > 0 && <Badge tone="warn">ซ่อม</Badge>} />
                <Kpi label="คนขับที่ใช้งาน" value={counts.drivers} sub={`ปิดบัญชี ${ds.length - counts.drivers} คน`} />
            </div>

            <Tabs
                items={[['vehicles', `รถ ${usable.length}`], ['drivers', `คนขับ ${counts.drivers}`]]}
                value={tab}
                onChange={(k) => {
                    setErr('')
                    setNotice(null)
                    setParams(k === 'drivers' ? { tab: 'drivers' } : {})
                }}
            />
            <ErrorBox>{err}</ErrorBox>
            {notice && <Notice tone="brand">{notice}</Notice>}

            {tab === 'vehicles' ? (
                <Card>
                    {vs.length === 0 ? (
                        <Empty>ยังไม่มีรถ กด + เพิ่มรถ</Empty>
                    ) : (
                        <Table head={['ทะเบียน', 'ประเภท', 'บรรทุกได้', 'สถานะ', 'งานตอนนี้', 'คนขับประจำ', 'เที่ยว 30 วัน', { label: '', right: true }]} minWidth={860}>
                            {vs.map((v) => {
                                const [label, tone] = vehicleState(v)
                                const retired = v.status === 'retired'
                                return (
                                    <tr key={v.id} className={retired ? 'text-faint' : ''}>
                                        <td className="font-semibold">{v.plate}</td>
                                        <td>{v.type}</td>
                                        <td>{num(v.capacityKg)} กก.</td>
                                        <td><Badge tone={tone}>{label}</Badge></td>
                                        <td>{v.trip ? <span>{v.trip.code} <span className="text-muted">· {v.trip.driver}</span></span> : <span className="text-faint">–</span>}</td>
                                        <td>{v.regularDrivers || <span className="text-faint">–</span>}</td>
                                        <td>{num(v.trips30d)}</td>
                                        <td className="text-right whitespace-nowrap">
                                            {v.trip ? (
                                                <span className="text-xs text-muted">เปลี่ยนสถานะได้หลังส่งเสร็จ</span>
                                            ) : retired ? (
                                                <Button size="xs" variant="ghost" onClick={() => setVehicleStatus(v, 'available')}>นำกลับมาใช้</Button>
                                            ) : (
                                                <span className="inline-flex gap-1.5">
                                                    {v.status === 'maintenance' ? (
                                                        <Button size="xs" variant="ghost" onClick={() => setVehicleStatus(v, 'available')}>ซ่อมเสร็จ · พร้อมใช้</Button>
                                                    ) : (
                                                        <Button size="xs" variant="ghost" onClick={() => setVehicleStatus(v, 'maintenance')}>ส่งซ่อม</Button>
                                                    )}
                                                    <Button
                                                        size="xs"
                                                        variant="danger"
                                                        onClick={() => setModal({ confirm: { title: `เลิกใช้รถ ${v.plate}?`, body: 'รถจะไม่โผล่ในหน้าจัดเที่ยว และถูกถอดออกจากการเป็นรถประจำของคนขับ ประวัติเที่ยวเก่ายังอยู่ครบ นำกลับมาใช้ได้ภายหลัง', ok: 'เลิกใช้', run: () => setVehicleStatus(v, 'retired') } })}
                                                    >
                                                        เลิกใช้
                                                    </Button>
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </Table>
                    )}
                </Card>
            ) : (
                <Card>
                    {ds.length === 0 ? (
                        <Empty>ยังไม่มีคนขับ กด + เพิ่มคนขับ</Empty>
                    ) : (
                        <Table head={['คนขับ', 'เบอร์โทร', 'รถประจำ', 'สถานะ', 'เที่ยว 30 วัน', { label: '', right: true }]} minWidth={860}>
                            {ds.map((d) => (
                                <tr key={d.id} className={d.enabled ? '' : 'text-faint'}>
                                    <td>
                                        <span className="flex items-center gap-2.5">
                                            <Avatar name={d.name} size={32} tone={d.enabled ? 'blue' : 'amber'} />
                                            <span className="min-w-0">
                                                <span className="block font-semibold">{d.name}</span>
                                                <span className="block text-xs text-muted">{d.email}</span>
                                            </span>
                                        </span>
                                    </td>
                                    <td>{d.phone || <span className="text-faint">–</span>}</td>
                                    <td className="w-[190px]">
                                        {d.enabled ? (
                                            <Select
                                                small
                                                ariaLabel={`รถประจำของ ${d.name}`}
                                                value={d.defaultVehicleId ?? ''}
                                                options={vehicleOptions}
                                                onChange={(v) => setDriver(d, { default_vehicle_id: v === '' ? null : Number(v) }, `${d.name}: รถประจำ ${v === '' ? 'ไม่มี' : usable.find((x) => x.id === Number(v))?.plate}`)}
                                            />
                                        ) : (
                                            d.defaultPlate || '–'
                                        )}
                                    </td>
                                    <td>
                                        {!d.enabled ? <Badge>ปิดบัญชี</Badge> : d.trip ? <Badge tone="dark">มีงาน {d.trip.code}</Badge> : <Badge tone="brand">ว่าง</Badge>}
                                    </td>
                                    <td>{num(d.trips30d)}</td>
                                    <td className="text-right whitespace-nowrap">
                                        <span className="inline-flex gap-1.5">
                                            {d.enabled && <Button size="xs" variant="ghost" onClick={() => setModal({ password: d })}><KeyRound size={13} /> ตั้งรหัสใหม่</Button>}
                                            {d.enabled ? (
                                                <Button
                                                    size="xs"
                                                    variant="danger"
                                                    disabled={!!d.trip}
                                                    title={d.trip ? 'มีงานค้างอยู่ ปิดบัญชีได้หลังส่งเสร็จ' : undefined}
                                                    onClick={() => setModal({ confirm: { title: `ปิดบัญชี ${d.name}?`, body: 'คนขับจะล็อกอินไม่ได้ทันที และไม่โผล่ในหน้าจัดเที่ยว ประวัติเที่ยวเก่ายังอยู่ครบ เปิดบัญชีคืนได้ภายหลัง', ok: 'ปิดบัญชี', run: () => setDriver(d, { enabled: false }, `ปิดบัญชี ${d.name} แล้ว`) } })}
                                                >
                                                    ปิดบัญชี
                                                </Button>
                                            ) : (
                                                <Button size="xs" variant="ghost" onClick={() => setDriver(d, { enabled: true }, `เปิดบัญชี ${d.name} แล้ว`)}>เปิดบัญชีคืน</Button>
                                            )}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </Table>
                    )}
                </Card>
            )}

            <AddVehicleModal open={modal === 'vehicle'} onClose={() => setModal(null)} onDone={(plate) => { setModal(null); setNotice(`เพิ่มรถ ${plate} แล้ว · พร้อมใช้ในหน้าจัดเที่ยว`); refresh() }} />
            <AddDriverModal open={modal === 'driver'} vehicleOptions={vehicleOptions} onClose={() => setModal(null)} onDone={(cred) => { setModal({ cred }); refresh() }} />
            <PasswordModal user={modal?.password} endpoint={`/fleet/drivers/${modal?.password?.id}/password`} who="คนขับ" onClose={() => setModal(null)} onDone={(cred) => setModal({ cred })} />
            <CredentialModal cred={modal?.cred} who="คนขับ" onClose={() => setModal(null)} />
            <ConfirmModal c={modal?.confirm} onClose={() => setModal(null)} />
        </>
    )
}

function AddVehicleModal({ open, onClose, onDone }) {
    const [f, setF] = useState({ plate: '', type: TYPES[0], capacity: '1500' })
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    useEffect(() => {
        if (open) {
            setF({ plate: '', type: TYPES[0], capacity: '1500' })
            setErr('')
        }
    }, [open])
    const cap = Number(f.capacity)
    const ready = f.plate.trim() && f.type.trim() && cap >= 100 && cap <= 40000

    const save = async () => {
        setBusy(true)
        setErr('')
        try {
            await api.post('/fleet/vehicles', { plate: f.plate.trim(), type: f.type.trim(), capacity_kg: cap })
            onDone(f.plate.trim())
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal open={open} onClose={onClose} title="เพิ่มรถ" width={440}>
            <div className="flex flex-col gap-4">
                <Field label="ทะเบียนรถ">
                    <input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} maxLength={20} placeholder="เช่น 5กข-1234" className={FIELD} autoFocus />
                </Field>
                <Field label="ประเภท" group>
                    <div className="flex flex-wrap gap-2">
                        {TYPES.map((t) => (
                            <button key={t} type="button" onClick={() => setF({ ...f, type: t, capacity: { 'รถ 4 ล้อ': '1500', 'รถ 6 ล้อ': '3500', 'รถ 10 ล้อ': '12000', 'รถกระบะ': '1000' }[t] })} className={`h-8 rounded-[10px] px-3 text-[13px] ${f.type === t ? 'bg-ink font-semibold text-white' : 'border border-line bg-white hover:bg-soft'}`}>
                                {t}
                            </button>
                        ))}
                    </div>
                </Field>
                <Field label="น้ำหนักบรรทุกสูงสุด (กก.)" hint="หน้าจัดเที่ยวใช้ตัวเลขนี้กันรถบรรทุกเกิน · 100–40,000 กก.">
                    <input value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" className={FIELD} />
                </Field>
                <ErrorBox>{err}</ErrorBox>
                <Button size="lg" disabled={!ready} loading={busy} onClick={save}>บันทึกรถ</Button>
            </div>
        </Modal>
    )
}

function AddDriverModal({ open, vehicleOptions, onClose, onDone }) {
    const blank = () => ({ name: '', email: '', phone: '', vehicle: '', password: tempPassword() })
    const [f, setF] = useState(blank)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    useEffect(() => {
        if (open) {
            setF(blank())
            setErr('')
        }
    }, [open])
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
    const ready = f.name.trim().length >= 2 && EMAIL_RE.test(f.email.trim()) && f.password.length >= 8

    const save = async () => {
        setBusy(true)
        setErr('')
        try {
            const { data } = await api.post('/fleet/drivers', {
                name: f.name,
                email: f.email,
                phone: f.phone,
                password: f.password,
                default_vehicle_id: f.vehicle === '' ? null : Number(f.vehicle),
            })
            onDone({ name: f.name.trim(), email: data.email, password: f.password, isNew: true })
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal open={open} onClose={onClose} title="เพิ่มคนขับ" width={480}>
            <div className="flex flex-col gap-4">
                <Field label="ชื่อ-นามสกุล">
                    <input value={f.name} onChange={set('name')} maxLength={100} placeholder="เช่น ประยุทธ์ ขับดี" className={FIELD} autoFocus />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="อีเมล (ใช้ล็อกอิน)">
                        <input value={f.email} onChange={set('email')} maxLength={120} type="email" placeholder="name@bl.test" className={FIELD} />
                    </Field>
                    <Field label="เบอร์โทร">
                        <input value={f.phone} onChange={set('phone')} maxLength={20} inputMode="tel" placeholder="089-000-0000" className={FIELD} />
                    </Field>
                </div>
                <Field label="รถประจำ" group hint="ตอนจัดเที่ยว เลือกคนขับคนนี้แล้วระบบเลือกรถคันนี้ให้อัตโนมัติ">
                    <Select ariaLabel="รถประจำ" value={f.vehicle} options={vehicleOptions} onChange={(v) => setF({ ...f, vehicle: v })} />
                </Field>
                <Field label="รหัสผ่านชั่วคราว" group hint="อย่างน้อย 8 ตัวอักษร · ส่งให้คนขับหลังบันทึก">
                    <PasswordInput label="รหัสผ่านชั่วคราว" value={f.password} onChange={(v) => setF({ ...f, password: v })} />
                </Field>
                <ErrorBox>{err}</ErrorBox>
                <Button size="lg" disabled={!ready} loading={busy} onClick={save}>สร้างบัญชีคนขับ</Button>
            </div>
        </Modal>
    )
}
