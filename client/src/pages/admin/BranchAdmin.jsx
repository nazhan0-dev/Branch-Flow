import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { KeyRound, MapPin, Pencil, UserPlus } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { Avatar, Badge, Button, Card, ErrorBox, Modal, Notice, Select, Table } from '../../components/ui'
import { ConfirmModal, CredentialModal, EMAIL_RE, FIELD, Field, PasswordInput, PasswordModal, tempPassword } from '../../components/accounts'

/**
 * Admin จัดการสาขา
 *  - AddBranchButton: ปุ่ม + เพิ่มสาขา (ฟอร์มปักหมุดบนแผนที่ + บัญชีพนักงานคนแรก)
 *  - BranchManage: การ์ดบนหน้า Dashboard ของสาขา (แก้ข้อมูล, ปิด/เปิดสาขา, บัญชีพนักงาน)
 */

const REGIONS = ['กรุงเทพฯ และปริมณฑล', 'ภาคกลาง', 'ภาคเหนือ', 'ภาคตะวันออกเฉียงเหนือ', 'ภาคตะวันออก', 'ภาคตะวันตก', 'ภาคใต้']
// ---------- แผนที่ปักหมุด ----------

const PIN = L.divIcon({
    className: '',
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    html: `<svg width="34" height="44" viewBox="0 0 40 50" style="filter:drop-shadow(0 3px 4px rgba(20,22,20,.3))"><path d="M20 48C20 48 4 31.5 4 19.5a16 16 0 1 1 32 0C36 31.5 20 48 20 48Z" fill="#1f9d55" stroke="#fff" stroke-width="2.5"/><circle cx="20" cy="19.5" r="6" fill="#fff"/></svg>`,
})
const dot = (bg) => L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div style="width:14px;height:14px;border-radius:99px;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)"></div>` })
const OTHER = dot('#9aa09a')
const HUB = dot('#141614')

const ClickToPin = ({ onPick }) => {
    useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) })
    return null
}
const FlyTo = ({ to }) => {
    const map = useMap()
    useEffect(() => {
        if (to) map.flyTo(to, Math.max(map.getZoom(), 13), { duration: 0.6 })
    }, [map, to])
    return null
}

/** คลิกบนแผนที่ (หรือลากหมุด) เพื่อเลือกตำแหน่งสาขา · จุดเทา = สาขาอื่น · จุดดำ = คลังกลาง */
function MapPicker({ value, onChange, others = [], selfId }) {
    const [fly, setFly] = useState(null)
    const center = value || others.find((b) => b.isWarehouse)?.pos || [13.7563, 100.5018]
    const locate = () => {
        if (!navigator.geolocation) return
        navigator.geolocation.getCurrentPosition((p) => {
            const pos = [p.coords.latitude, p.coords.longitude]
            onChange(pos)
            setFly(pos)
        })
    }
    return (
        <div className="relative overflow-hidden rounded-2xl border border-line">
            <MapContainer center={center} zoom={value ? 14 : 11} className="h-[260px] w-full" scrollWheelZoom attributionControl={false}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <ClickToPin onPick={onChange} />
                <FlyTo to={fly} />
                {others
                    .filter((b) => b.id !== selfId)
                    .map((b) => (
                        <Marker key={b.id} position={b.pos} icon={b.isWarehouse ? HUB : OTHER} interactive>
                            <Tooltip direction="top" offset={[0, -6]}>{b.name}</Tooltip>
                        </Marker>
                    ))}
                {value && (
                    <Marker
                        position={value}
                        icon={PIN}
                        draggable
                        eventHandlers={{ dragend: (e) => { const ll = e.target.getLatLng(); onChange([ll.lat, ll.lng]) } }}
                    />
                )}
            </MapContainer>
            <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[500] flex items-end justify-between gap-2">
                <span className="rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] text-muted shadow-sm">{value ? `${value[0].toFixed(5)}, ${value[1].toFixed(5)} · ลากหมุดเพื่อขยับ` : 'คลิกบนแผนที่เพื่อปักหมุดสาขา'}</span>
                <button type="button" onClick={locate} className="pointer-events-auto rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm hover:bg-soft">
                    <MapPin size={12} className="mr-1 inline" />ตำแหน่งปัจจุบัน
                </button>
            </div>
        </div>
    )
}

const useOtherBranches = (open) => {
    const [list, setList] = useState([])
    useEffect(() => {
        if (!open) return
        api.get('/branches', { params: { all: 1 } }).then((r) => setList(r.data.map((b) => ({ id: b.id, code: b.code, name: b.name, isWarehouse: !!b.isWarehouse, pos: [Number(b.lat), Number(b.lng)] })))).catch(() => setList([]))
    }, [open])
    return list
}

// รหัสสาขาถัดไป: B + เลข 4 หลักที่มากที่สุด + 1 (เช่น B5101 → B5102)
const nextCode = (list) => {
    const nums = list.filter((b) => !b.isWarehouse).map((b) => /^B(\d+)$/.exec(b.code)?.[1]).filter(Boolean).map(Number)
    return `B${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`
}

const regionOptions = (extra) => [...new Set([...REGIONS, ...(extra ? [extra] : [])])].map((r) => [r, r])

// ---------- เพิ่มสาขา ----------

export function AddBranchButton({ onDone }) {
    const [open, setOpen] = useState(false)
    const [cred, setCred] = useState(null)
    const navigate = useNavigate()
    return (
        <>
            <Button onClick={() => setOpen(true)}>+ เพิ่มสาขา</Button>
            <BranchFormModal
                open={open}
                onClose={() => setOpen(false)}
                onDone={(res) => {
                    setOpen(false)
                    onDone?.()
                    if (res.cred) setCred({ ...res.cred, branchId: res.id })
                    else navigate(`/admin/branches/${res.id}`)
                }}
            />
            <CredentialModal
                cred={cred}
                who="พนักงานสาขา"
                onClose={() => {
                    const id = cred?.branchId
                    setCred(null)
                    if (id) navigate(`/admin/branches/${id}`)
                }}
            />
        </>
    )
}

/** ฟอร์มเพิ่ม/แก้ข้อมูลสาขา · branch = แก้ไข (ไม่มีส่วนบัญชีพนักงาน) */
function BranchFormModal({ open, branch, onClose, onDone }) {
    const editing = !!branch
    const blank = () => ({
        code: branch?.code || '',
        name: branch?.name || '',
        region: branch?.region || REGIONS[0],
        address: branch?.address || '',
        pos: branch ? [Number(branch.lat), Number(branch.lng)] : null,
        withStaff: true,
        staffName: '',
        email: '',
        phone: '',
        password: tempPassword(),
    })
    const [f, setF] = useState(blank)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const others = useOtherBranches(open)
    useEffect(() => {
        if (open) {
            setF(blank())
            setErr('')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])
    // เติมรหัสถัดไปให้ (แก้เองได้) เมื่อโหลดรายชื่อสาขาเสร็จ
    useEffect(() => {
        if (open && !editing && others.length) setF((x) => (x.code ? x : { ...x, code: nextCode(others) }))
    }, [open, editing, others])
    const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
    const staffOk = editing || !f.withStaff || (f.staffName.trim().length >= 2 && EMAIL_RE.test(f.email.trim()) && f.password.length >= 8)
    const ready = (editing || /^[A-Za-z0-9-]{2,10}$/.test(f.code.trim())) && f.name.trim() && f.region && f.pos && staffOk

    const save = async () => {
        setBusy(true)
        setErr('')
        const body = { name: f.name, region: f.region, address: f.address, lat: f.pos[0], lng: f.pos[1] }
        try {
            if (editing) {
                await api.patch(`/branches/${branch.id}`, body)
                onDone({ id: branch.id })
            } else {
                const staff = f.withStaff ? { name: f.staffName, email: f.email, phone: f.phone, password: f.password } : undefined
                const { data } = await api.post('/branches', { ...body, code: f.code, staff })
                onDone({
                    id: data.id,
                    cred: data.staff && { name: f.staffName.trim(), email: data.staff.email, password: f.password, isNew: true, note: `สาขา${f.name.trim()} (${data.code})${data.drafted ? ' · ระบบร่างคำขอล็อตแรกให้สาขาแล้ว' : ''}` },
                })
            }
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal open={open} onClose={onClose} title={editing ? `แก้ข้อมูลสาขา${branch.name}` : 'เพิ่มสาขา'} width={620}>
            <div className="flex flex-col gap-4">
                <div className="grid grid-cols-[1fr_2fr] gap-3">
                    <Field label="รหัสสาขา" hint={editing ? 'เปลี่ยนรหัสไม่ได้' : 'A-Z, 0-9 และ - · เติมเลขถัดไปให้แล้ว'}>
                        <input value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} maxLength={10} placeholder="B0001" className={`${FIELD} font-mono uppercase`} disabled={editing} autoFocus={!editing} />
                    </Field>
                    <Field label="ชื่อสาขา">
                        <input value={f.name} onChange={set('name')} maxLength={100} placeholder="เช่น บางนา" className={FIELD} autoFocus={editing} />
                    </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
                    <Field label="ภาค" group>
                        <Select ariaLabel="ภาค" value={f.region} options={regionOptions(branch?.region)} onChange={(v) => setF((x) => ({ ...x, region: v }))} />
                    </Field>
                    <Field label="ที่อยู่ (ไม่บังคับ)">
                        <input value={f.address} onChange={set('address')} maxLength={255} placeholder="ถนน เขต จังหวัด" className={FIELD} />
                    </Field>
                </div>
                <Field label="ตำแหน่งสาขา" group hint="ใช้วางหมุดบนแผนที่ คำนวณเส้นทางและเวลาถึงของรถ">
                    <MapPicker value={f.pos} onChange={(pos) => setF((x) => ({ ...x, pos }))} others={others} selfId={branch?.id} />
                </Field>

                {!editing && (
                    <div className="rounded-2xl border border-line p-4">
                        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
                            <input type="checkbox" checked={f.withStaff} onChange={(e) => setF((x) => ({ ...x, withStaff: e.target.checked }))} className="size-4 accent-[#141614]" />
                            สร้างบัญชีพนักงานสาขาคนแรกด้วย
                        </label>
                        {f.withStaff && (
                            <div className="mt-3.5 flex flex-col gap-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="ชื่อพนักงาน">
                                        <input value={f.staffName} onChange={set('staffName')} maxLength={100} placeholder="เช่น ชไมพร ใจดี" className={FIELD} />
                                    </Field>
                                    <Field label="เบอร์โทร (ไม่บังคับ)">
                                        <input value={f.phone} onChange={set('phone')} maxLength={20} inputMode="tel" placeholder="081-000-0000" className={FIELD} />
                                    </Field>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="อีเมล (ใช้ล็อกอิน)">
                                        <input value={f.email} onChange={set('email')} maxLength={120} type="email" placeholder="name@bl.test" className={FIELD} />
                                    </Field>
                                    <Field label="รหัสผ่านชั่วคราว" group hint="อย่างน้อย 8 ตัวอักษร">
                                        <PasswordInput label="รหัสผ่านชั่วคราว" value={f.password} onChange={(v) => setF((x) => ({ ...x, password: v }))} />
                                    </Field>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {!editing && <p className="text-xs text-muted">สาขาใหม่เริ่มที่สต็อก 0 ทุกสินค้า จุดสั่งซื้อ/เพดานใช้ค่ามาตรฐานที่ตั้งไว้ตอนเพิ่มสินค้า แล้วระบบร่างคำขอล็อตแรกให้สาขาทันที</p>}
                <ErrorBox>{err}</ErrorBox>
                <Button size="lg" disabled={!ready} loading={busy} onClick={save}>{editing ? 'บันทึก' : 'เพิ่มสาขา'}</Button>
            </div>
        </Modal>
    )
}

// ---------- การ์ดจัดการบนหน้าสาขา ----------

export function BranchManage({ branchId }) {
    const { data: b, error, reload } = useApi(`/admin/branches/${branchId}`)
    const [modal, setModal] = useState(null)
    const [notice, setNotice] = useState('')
    const [err, setErr] = useState('')
    const refresh = useCallback(() => reload(), [reload])
    useSocket('branches_changed', refresh)
    useSocket('requests_changed', refresh)
    const active = useMemo(() => (b?.users || []).filter((u) => u.enabled).length, [b])

    if (error) return <ErrorBox>{error}</ErrorBox>
    if (!b) return null

    const run = async (fn, msg) => {
        setErr('')
        try {
            await fn()
            setNotice(msg)
            reload()
        } catch (e) {
            setErr(errMsg(e))
        }
    }
    const setUser = (u, enabled) => run(() => api.patch(`/branch-users/${u.id}`, { enabled }), enabled ? `เปิดบัญชี ${u.name} แล้ว` : `ปิดบัญชี ${u.name} แล้ว`)
    const setActive = (on) => run(() => api.patch(`/branches/${b.id}`, { active: on }), on ? `เปิดสาขา${b.name}แล้ว · พนักงานล็อกอินได้อีกครั้ง` : `ปิดสาขา${b.name}แล้ว`)

    return (
        <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        จัดการสาขา {b.active ? <Badge tone="brand">เปิดอยู่</Badge> : <Badge tone="danger">ปิดแล้ว</Badge>}
                    </div>
                    <div className="mt-0.5 text-sm text-muted">{[b.code, b.region, b.address].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setModal({ edit: true })}><Pencil size={14} /> แก้ข้อมูล / ย้ายหมุด</Button>
                    {b.active ? (
                        <Button
                            size="sm"
                            variant="danger"
                            disabled={b.shipping > 0}
                            title={b.shipping > 0 ? 'มีของที่อนุมัติแล้วหรือกำลังส่ง ปิดได้หลังส่งเสร็จหรือยกเลิกคำขอ' : undefined}
                            onClick={() =>
                                setModal({
                                    confirm: {
                                        title: `ปิดสาขา${b.name}?`,
                                        body: `พนักงานของสาขาจะล็อกอินไม่ได้ทันที ระบบหยุดร่างคำขอให้สาขานี้${b.waiting ? ` และยกเลิกคำขอที่ยังไม่อนุมัติ ${b.waiting} ใบ` : ''} ประวัติเก่ายังอยู่ครบ เปิดสาขากลับได้ภายหลัง`,
                                        ok: 'ปิดสาขา',
                                        run: () => setActive(false),
                                    },
                                })
                            }
                        >
                            ปิดสาขา
                        </Button>
                    ) : (
                        <Button size="sm" onClick={() => setActive(true)}>เปิดสาขากลับ</Button>
                    )}
                </div>
            </div>
            {b.active && b.shipping > 0 && <div className="text-xs text-muted">มีของที่อนุมัติแล้วหรือกำลังส่ง {b.shipping} คำขอ · ปิดสาขาได้หลังส่งเสร็จ</div>}
            {!b.active && <Notice tone="danger">สาขานี้ปิดอยู่ พนักงานล็อกอินไม่ได้ และระบบไม่ร่างคำขอให้</Notice>}
            <Notice tone="brand">{notice}</Notice>
            <ErrorBox>{err}</ErrorBox>

            <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">บัญชีพนักงาน <span className="font-normal text-muted">· ใช้งาน {active} จาก {b.users.length}</span></div>
                    <Button size="xs" variant="ghost" onClick={() => setModal({ add: true })}><UserPlus size={13} /> เพิ่มพนักงาน</Button>
                </div>
                {b.users.length === 0 ? (
                    <div className="rounded-2xl bg-soft px-4 py-3 text-sm text-muted">ยังไม่มีบัญชีพนักงาน สาขานี้ยังเข้าระบบไม่ได้ กด "เพิ่มพนักงาน"</div>
                ) : (
                    <Table head={['พนักงาน', 'เบอร์โทร', 'สถานะ', { label: '', right: true }]} minWidth={560}>
                        {b.users.map((u) => (
                            <tr key={u.id} className={u.enabled ? '' : 'text-faint'}>
                                <td>
                                    <span className="flex items-center gap-2.5">
                                        <Avatar name={u.name} size={32} tone={u.enabled ? 'green' : 'amber'} />
                                        <span className="min-w-0">
                                            <span className="block font-semibold">{u.name}</span>
                                            <span className="block text-xs text-muted">{u.email}</span>
                                        </span>
                                    </span>
                                </td>
                                <td>{u.phone || <span className="text-faint">–</span>}</td>
                                <td>{u.enabled ? <Badge tone="brand">ใช้งาน</Badge> : <Badge>ปิดบัญชี</Badge>}</td>
                                <td className="text-right whitespace-nowrap">
                                    <span className="inline-flex gap-1.5">
                                        {u.enabled && <Button size="xs" variant="ghost" onClick={() => setModal({ password: u })}><KeyRound size={13} /> ตั้งรหัสใหม่</Button>}
                                        {u.enabled ? (
                                            <Button size="xs" variant="danger" onClick={() => setModal({ confirm: { title: `ปิดบัญชี ${u.name}?`, body: 'ล็อกอินไม่ได้ทันที ประวัติการทำงานยังอยู่ เปิดบัญชีคืนได้ภายหลัง', ok: 'ปิดบัญชี', run: () => setUser(u, false) } })}>ปิดบัญชี</Button>
                                        ) : (
                                            <Button size="xs" variant="ghost" onClick={() => setUser(u, true)}>เปิดบัญชีคืน</Button>
                                        )}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </Table>
                )}
            </div>

            <BranchFormModal open={!!modal?.edit} branch={b} onClose={() => setModal(null)} onDone={() => { setModal(null); setNotice('บันทึกข้อมูลสาขาแล้ว'); reload() }} />
            <AddStaffModal branch={modal?.add ? b : null} onClose={() => setModal(null)} onDone={(cred) => { setModal({ cred }); reload() }} />
            <PasswordModal user={modal?.password} endpoint={`/branch-users/${modal?.password?.id}/password`} who="พนักงาน" onClose={() => setModal(null)} onDone={(cred) => setModal({ cred })} />
            <CredentialModal cred={modal?.cred} who="พนักงานสาขา" onClose={() => setModal(null)} />
            <ConfirmModal c={modal?.confirm} onClose={() => setModal(null)} />
        </Card>
    )
}

function AddStaffModal({ branch, onClose, onDone }) {
    const blank = () => ({ name: '', email: '', phone: '', password: tempPassword() })
    const [f, setF] = useState(blank)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    useEffect(() => {
        if (branch) {
            setF(blank())
            setErr('')
        }
    }, [branch])
    const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
    const ready = f.name.trim().length >= 2 && EMAIL_RE.test(f.email.trim()) && f.password.length >= 8
    const save = async () => {
        setBusy(true)
        setErr('')
        try {
            const { data } = await api.post(`/branches/${branch.id}/users`, f)
            onDone({ name: f.name.trim(), email: data.email, password: f.password, isNew: true, note: `พนักงานสาขา${branch.name}` })
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }
    return (
        <Modal open={!!branch} onClose={onClose} title={branch ? `เพิ่มพนักงาน · สาขา${branch.name}` : ''} width={480}>
            <div className="flex flex-col gap-4">
                <Field label="ชื่อ-นามสกุล">
                    <input value={f.name} onChange={set('name')} maxLength={100} placeholder="เช่น สมพร รักงาน" className={FIELD} autoFocus />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="อีเมล (ใช้ล็อกอิน)">
                        <input value={f.email} onChange={set('email')} maxLength={120} type="email" placeholder="name@bl.test" className={FIELD} />
                    </Field>
                    <Field label="เบอร์โทร">
                        <input value={f.phone} onChange={set('phone')} maxLength={20} inputMode="tel" placeholder="081-000-0000" className={FIELD} />
                    </Field>
                </div>
                <Field label="รหัสผ่านชั่วคราว" group hint="อย่างน้อย 8 ตัวอักษร · ส่งให้พนักงานหลังบันทึก">
                    <PasswordInput label="รหัสผ่านชั่วคราว" value={f.password} onChange={(v) => setF((x) => ({ ...x, password: v }))} />
                </Field>
                <ErrorBox>{err}</ErrorBox>
                <Button size="lg" disabled={!ready} loading={busy} onClick={save}>สร้างบัญชีพนักงาน</Button>
            </div>
        </Modal>
    )
}
