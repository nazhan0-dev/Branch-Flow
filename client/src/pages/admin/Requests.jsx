import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useNow } from '../../lib/useNow'
import { useSocket } from '../../lib/socket'
import { REQUEST_STATUS, SOURCE, countdown, date, isToday, minutesUntil, time, weight , num } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, Notice, PageHeader, Segmented, Select, StatusBadge, Stepper, Table, Tabs } from '../../components/ui'

const TABS = [
    ['all', 'ทั้งหมด', () => true],
    ['pending', 'รออนุมัติ', (r) => r.status === 'pending'],
    ['draft', 'ร่างอัตโนมัติ', (r) => r.status === 'draft'],
    ['approved', 'อนุมัติแล้ว', (r) => r.status === 'approved'],
    ['in_transit', 'กำลังส่ง', (r) => r.status === 'in_transit'],
    ['closed', 'ปิดแล้ว', (r) => ['received', 'rejected', 'cancelled'].includes(r.status)],
]

export const urgencyPill = (r) =>
    r.priority === 'urgent' ? <Badge tone="danger">{r.hasOut ? 'ด่วน · ของหมด' : 'ด่วน'}</Badge> : <Badge tone="warn">ปกติ</Badge>
const when = (d) => (isToday(d) ? time(d) : `${date(d)} ${time(d)}`)

export default function AdminRequests() {
    const { id } = useParams()
    const navigate = useNavigate()
    const [tab, setTab] = useState('pending')
    const [region, setRegion] = useState('')
    const [creating, setCreating] = useState(false)
    const { data, error, loading, reload } = useApi('/requests')
    useSocket('requests_changed', useCallback(() => reload(), [reload]))
    useSocket('trip_changed', useCallback(() => reload(), [reload]))

    const regions = useMemo(() => [...new Set((data || []).map((r) => r.region))], [data])
    const scoped = useMemo(() => (data || []).filter((r) => !region || r.region === region), [data, region])
    const rows = scoped.filter(TABS.find((t) => t[0] === tab)[2])
    const selected = Number(id) || null

    useEffect(() => {
        if (!selected && rows.length) navigate(`/admin/requests/${rows[0].id}`, { replace: true })
    }, [selected, rows, navigate])

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>

    return (
        <>
            <PageHeader
                title="คำขอเติมสินค้า"
                sub={`จากทุกสาขา · วันนี้ ${date(new Date())}`}
                actions={
                    <>
                        <Select variant="pill" label="ภาค" value={region} onChange={setRegion} options={[['', 'ทุกภาค'], ...regions.map((r) => [r, r])]} align="right" />
                        <Button onClick={() => setCreating(true)}>+ สร้างคำขอให้สาขา</Button>
                    </>
                }
            />
            <Tabs items={TABS.map(([k, label, fn]) => [k, `${label} ${scoped.filter(fn).length}`])} value={tab} onChange={setTab} className="self-start" />

            <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
                <Card className="min-w-0">
                    {rows.length === 0 ? (
                        <Empty>ไม่มีคำขอในกลุ่มนี้</Empty>
                    ) : (
                        <Table head={['เลขที่', 'สาขา', 'ที่มา', 'รายการ', 'สร้างเมื่อ', { label: 'ความเร่งด่วน', right: true }]} minWidth={640}>
                            {rows.map((r) => (
                                <tr key={r.id} onClick={() => navigate(`/admin/requests/${r.id}`)} className={`cursor-pointer ${selected === r.id ? 'bg-soft' : 'hover:bg-soft/60'}`}>
                                    <td className="font-semibold">{r.code}</td>
                                    <td>{r.branchName}</td>
                                    <td><Badge>{SOURCE[r.source]}</Badge></td>
                                    <td>{r.itemCount} รายการ · {weight(r.weightTon)}</td>
                                    <td className="text-muted">{when(r.submittedAt || r.createdAt)}</td>
                                    <td className="text-right">{urgencyPill(r)}</td>
                                </tr>
                            ))}
                        </Table>
                    )}
                </Card>
                {selected && <ApprovePanel id={selected} />}
            </div>

            <CreateForBranch open={creating} onClose={() => setCreating(false)} onCreated={(rid) => { setCreating(false); setTab('pending'); navigate(`/admin/requests/${rid}`) }} />
        </>
    )
}

function ApprovePanel({ id }) {
    const navigate = useNavigate()
    useNow() // เวลา/นับถอยหลังบนหน้าเดินเองทุก 30 วินาที
    const { data: r, error, loading, reload } = useApi(`/requests/${id}`)
    const wh = useApi('/warehouse/stock')
    const [approve, setApprove] = useState({})
    const [rejecting, setRejecting] = useState(false)
    const [cancelling, setCancelling] = useState(false)
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState('')
    const [err, setErr] = useState({ message: '', details: null })
    const reloadWh = wh.reload
    useSocket('requests_changed', useCallback(() => { reload(); reloadWh() }, [reload, reloadWh]))

    const demand = useMemo(() => new Map((wh.data || []).map((w) => [w.productId, w])), [wh.data])

    // จำนวนเริ่มต้น: ถ้าคลังไม่พอ ใช้ข้อเสนอการจัดสรร (ด่วน/ของหมดได้ก่อน) ไม่งั้นให้เท่าที่ขอ
    useEffect(() => {
        if (!r || r.status !== 'pending' || !wh.data) return
        let alive = true
        ;(async () => {
            const next = {}
            for (const i of r.items) {
                const w = demand.get(i.productId)
                if (w && w.requested > w.available) {
                    const plan = await api.get(`/warehouse/allocation/${i.productId}`).then((x) => x.data.plan).catch(() => [])
                    next[i.productId] = plan.find((p) => p.requestId === r.id)?.suggested ?? Math.min(i.qtyRequested, Math.max(i.warehouseAvailable, 0))
                } else next[i.productId] = Math.min(i.qtyRequested, Math.max(i.warehouseAvailable ?? 0, 0))
            }
            if (alive) setApprove(next)
        })()
        setRejecting(false)
        setErr({ message: '', details: null })
        return () => {
            alive = false
        }
    }, [r, wh.data, demand])

    if (loading && !r) return <Card><Loading /></Card>
    if (error) return <Card><ErrorBox>{error}</ErrorBox></Card>
    const pending = r.status === 'pending'
    const reduced = pending ? r.items.filter((i) => approve[i.productId] != null && approve[i.productId] < i.qtyRequested) : []

    const run = async (key, fn) => {
        setBusy(key)
        setErr({ message: '', details: null })
        try {
            await fn()
            await reload()
            reloadWh()
        } catch (e) {
            setErr({ message: errMsg(e), details: e.response?.data?.details })
        } finally {
            setBusy('')
        }
    }

    return (
        <Card className="flex h-fit flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="text-xs text-muted">{r.code} · {SOURCE[r.source]} {time(r.submitted_at || r.created_at)}</div>
                    <div className="text-lg font-semibold">สาขา{r.branch.name}</div>
                </div>
                {r.priority === 'urgent' ? <Badge tone="danger">ด่วน</Badge> : <StatusBadge map={REQUEST_STATUS} value={r.status} />}
            </div>

            <div className="flex justify-between border-b border-[#eef0ed] pb-2 text-xs text-faint">
                <span>สินค้า</span>
                <span>{pending ? 'ขอ → อนุมัติ' : 'ขอ / อนุมัติ / รับจริง'}</span>
            </div>
            <div>
                {r.items.map((i) => {
                    const w = demand.get(i.productId)
                    const short = w && w.requested > w.available
                    return (
                        <div key={i.productId} className="flex items-center justify-between gap-2 border-b border-[#f0f2ef] py-3 last:border-0">
                            <div className="min-w-0">
                                <div className="truncate font-semibold">{i.name}</div>
                                {pending ? (
                                    <div className={`text-xs ${short ? 'text-danger-ink' : 'text-muted'}`}>
                                        สาขามี {i.branchQty ?? 0} · {short ? `คลังเหลือ ${num(w.available)} · ทุกสาขาขอรวม ${num(w.requested)}` : `คลังมี ${num(w?.available ?? i.warehouseAvailable ?? 0)} · พอ`}
                                    </div>
                                ) : (
                                    <div className="text-xs text-muted">{i.sku} · สาขามี {i.branchQty ?? 0}</div>
                                )}
                            </div>
                            {pending ? (
                                <div className="flex items-center gap-2.5">
                                    <span className="text-sm text-muted">{i.qtyRequested}</span>
                                    <span className="text-faint">→</span>
                                    <Stepper value={approve[i.productId] ?? 0} max={i.qtyRequested} onChange={(v) => setApprove({ ...approve, [i.productId]: v })} />
                                </div>
                            ) : (
                                <span className="text-sm">
                                    {i.qtyRequested} / <b>{i.qtyApproved ?? '–'}</b> / {i.qtyReceived ?? '–'}
                                    {i.qtyDamaged > 0 && <span className="text-danger-ink"> (เสีย {i.qtyDamaged})</span>}
                                </span>
                            )}
                        </div>
                    )
                })}
            </div>

            {reduced.length > 0 && (
                <Notice>
                    {reduced.map((i) => (
                        <div key={i.productId}><b className="text-ink">{i.name}ลดจาก {i.qtyRequested} เหลือ {approve[i.productId]}</b></div>
                    ))}
                    <span className="text-[#5d625b]">เพราะคลังไม่พอสำหรับทุกสาขา ระบบแบ่งให้สาขาที่ด่วนและของเหลือน้อยก่อน</span>
                </Notice>
            )}
            {r.note && <div className="rounded-2xl bg-soft px-3.5 py-3 text-xs">{r.status === 'rejected' ? 'เหตุผลที่ปฏิเสธ' : r.status === 'cancelled' ? 'เหตุผลที่ยกเลิก' : 'หมายเหตุจากสาขา'}: {r.note}</div>}
            {r.status === 'draft' && <Notice tone="neutral">รอสาขายืนยัน{r.auto_submit_at ? ` · ระบบจะส่งเข้าคลังเองในอีก ${countdown(minutesUntil(r.auto_submit_at))}` : ''}</Notice>}
            {r.stop && <Button variant="ghost" onClick={() => navigate(`/admin/trips/${r.stop.tripId}`)}>ดูเที่ยวส่ง {r.stop.tripCode}</Button>}
            {r.status === 'approved' && !r.stop && !cancelling && (
                <div className="flex gap-2.5">
                    <Button variant="danger" className="flex-1" onClick={() => { setCancelling(true); setReason('') }}>ยกเลิกคำขอ</Button>
                    <Button variant="ghost" className="flex-[2]" onClick={() => navigate('/admin/planner')}>ไปจัดเที่ยวส่ง</Button>
                </div>
            )}
            {r.status === 'approved' && !r.stop && cancelling && (
                <div className="flex flex-col gap-2">
                    <div className="text-xs text-muted">ยอดที่จองไว้จะคืนกลับเข้าคลัง และสาขาจะได้รับแจ้ง</div>
                    <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ยกเลิก (สาขาจะเห็นข้อความนี้)" className="h-11 rounded-xl border border-line px-3.5 text-sm outline-none focus:border-ink" />
                    <div className="flex gap-2.5">
                        <Button variant="ghost" className="flex-1" onClick={() => setCancelling(false)}>ไม่ยกเลิก</Button>
                        <Button variant="danger" className="flex-[2] !border-danger" disabled={!reason.trim()} loading={busy === 'cancel'} onClick={() => run('cancel', async () => { await api.post(`/requests/${r.id}/cancel`, { reason }); setCancelling(false) })}>ยืนยันยกเลิกและคืนสต็อก</Button>
                    </div>
                </div>
            )}

            {err.message && (
                <ErrorBox>
                    {err.message}
                    {Array.isArray(err.details) && err.details.map((d) => <div key={d.productId}>· {d.name}: อนุมัติ {d.approved} แต่ว่าง {d.available}</div>)}
                </ErrorBox>
            )}

            {pending &&
                (rejecting ? (
                    <div className="flex flex-col gap-2">
                        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ปฏิเสธ (สาขาจะเห็นข้อความนี้)" className="h-11 rounded-xl border border-line px-3.5 text-sm outline-none focus:border-ink" />
                        <div className="flex gap-2.5">
                            <Button variant="ghost" size="lg" className="flex-1" onClick={() => setRejecting(false)}>ยกเลิก</Button>
                            <Button variant="danger" size="lg" className="flex-[2] !border-danger" disabled={!reason.trim()} loading={busy === 'reject'} onClick={() => run('reject', () => api.post(`/requests/${r.id}/reject`, { reason }))}>ยืนยันปฏิเสธ</Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex gap-2.5">
                        <Button variant="danger" size="lg" className="flex-1" onClick={() => setRejecting(true)}>ปฏิเสธ</Button>
                        <Button
                            size="lg"
                            className="flex-[2]"
                            loading={busy === 'approve'}
                            onClick={() => run('approve', () => api.post(`/requests/${r.id}/approve`, { items: r.items.map((i) => ({ product_id: i.productId, qty_approved: approve[i.productId] ?? 0 })) }))}
                        >
                            อนุมัติและจองสต็อก
                        </Button>
                    </div>
                ))}
        </Card>
    )
}

// คลังเสนอเติมของให้สาขา (source = hq) → เข้าสถานะรออนุมัติทันที
function CreateForBranch({ open, onClose, onCreated }) {
    const branches = useApi(open ? '/branches' : null, [open])
    const products = useApi(open ? '/products' : null, [open])
    const [branchId, setBranchId] = useState('')
    const [qty, setQty] = useState({})
    const [priority, setPriority] = useState('normal')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const items = Object.entries(qty).filter(([, v]) => v > 0)

    const submit = async () => {
        setBusy(true)
        setErr('')
        try {
            const res = await api.post('/requests', { branch_id: Number(branchId), items: items.map(([p, q]) => ({ product_id: Number(p), qty: q })), priority })
            setQty({})
            setBranchId('')
            onCreated(res.data.id)
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal open={open} onClose={onClose} title="สร้างคำขอให้สาขา">
            <div className="flex flex-col gap-3">
                <Select
                    ariaLabel="เลือกสาขา"
                    placeholder="เลือกสาขา"
                    value={branchId}
                    onChange={(v) => setBranchId(String(v))}
                    options={(branches.data || []).filter((b) => !b.isWarehouse).map((b) => ({ value: b.id, label: `${b.name} · ${b.code}`, hint: b.outItems > 0 ? `หมด ${b.outItems}` : b.lowItems > 0 ? `ใกล้หมด ${b.lowItems}` : null }))}
                />
                <div className="max-h-[45vh] overflow-y-auto rounded-2xl border border-line px-3.5">
                    {(products.data || []).map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 border-b border-[#f0f2ef] py-2.5 last:border-0">
                            <span className="text-sm"><b>{p.name}</b> <span className="text-muted">{p.sku}</span></span>
                            <Stepper value={qty[p.id] || 0} onChange={(v) => setQty({ ...qty, [p.id]: v })} />
                        </div>
                    ))}
                </div>
                <Segmented full items={[['normal', 'ปกติ'], ['urgent', 'ด่วน']]} value={priority} onChange={setPriority} />
                <ErrorBox>{err}</ErrorBox>
                <div className="flex gap-2.5">
                    <Button variant="ghost" size="lg" className="flex-1" onClick={onClose}>ยกเลิก</Button>
                    <Button size="lg" className="flex-[2]" disabled={!branchId || !items.length} loading={busy} onClick={submit}>สร้างคำขอ {items.length ? `(${items.length} รายการ)` : ''}</Button>
                </div>
            </div>
        </Modal>
    )
}
