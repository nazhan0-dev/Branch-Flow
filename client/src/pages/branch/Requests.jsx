import { useCallback, useEffect, useMemo, useState } from 'react'
import api, { errMsg } from '../../api/client'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { REQUEST_STATUS, SOURCE, dateTime, time } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Select, Table, Tabs, Timeline } from '../../components/ui'

const problem = (r) => r.status === 'rejected' || r.issueCount > 0
const TABS = [
    ['all', 'ทั้งหมด', () => true],
    ['waiting', 'รอยืนยัน', (r) => ['draft', 'pending'].includes(r.status)],
    ['moving', 'กำลังจัดส่ง', (r) => ['approved', 'in_transit'].includes(r.status)],
    ['done', 'รับแล้ว', (r) => r.status === 'received' && !problem(r)],
    ['issue', 'มีปัญหา', problem],
]
const RANGES = [
    [30, '30 วันล่าสุด'],
    [90, '90 วันล่าสุด'],
    [0, 'ทั้งหมด'],
]

// ป้ายสถานะในประวัติ: แยก "รับไม่ครบ" ออกจาก "รับแล้ว"
export const historyPill = (r) => {
    if (r.status === 'received' && r.issueCount > 0) return <Badge tone="danger">รับไม่ครบ</Badge>
    if (r.status === 'draft') return <Badge tone="warn">รอยืนยัน</Badge>
    if (r.status === 'in_transit' && r.stopStatus === 'arrived') return <Badge tone="warn">รถถึงแล้ว · รอนับ</Badge>
    const [label, tone] = REQUEST_STATUS[r.status]
    return <Badge tone={tone}>{label}</Badge>
}

export default function BranchRequests() {
    const navigate = useNavigate()
    const [params, setParams] = useSearchParams()
    const selected = Number(params.get('id')) || null
    const [tab, setTab] = useState('all')
    const [days, setDays] = useState(30)
    const { data, error, loading, reload } = useApi('/requests')
    useSocket('requests_changed', useCallback(() => reload(), [reload]))
    useSocket('trip_changed', useCallback(() => reload(), [reload]))

    const inRange = useMemo(() => (data || []).filter((r) => !days || Date.now() - new Date(r.createdAt) < days * 864e5), [data, days])
    const rows = inRange.filter(TABS.find((t) => t[0] === tab)[2])

    // เปิดหน้าแรกให้เลือกคำขอล่าสุดไว้
    useEffect(() => {
        if (!selected && rows.length) setParams({ id: rows[0].id }, { replace: true })
    }, [selected, rows, setParams])

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>

    return (
        <>
            <PageHeader
                title="ประวัติคำขอ"
                sub={`คำขอของสาขา · ${days ? `${days} วันล่าสุด` : 'ทั้งหมด'}`}
                actions={
                    <>
                        <Select small ariaLabel="ช่วงเวลา" value={days} onChange={setDays} options={RANGES} align="right" className="!w-auto shrink-0" />
                        <Button onClick={() => navigate('/branch/order')}>+ สั่งสินค้า</Button>
                    </>
                }
            />
            <Tabs items={TABS.map(([k, label, fn]) => [k, `${label} ${inRange.filter(fn).length}`])} value={tab} onChange={setTab} className="self-start" />

            <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
                <Card className="min-w-0">
                    {rows.length === 0 ? (
                        <Empty>ไม่มีคำขอในกลุ่มนี้</Empty>
                    ) : (
                        <Table head={['เลขที่', 'ที่มา', 'รายการ', 'วันที่', 'เที่ยวส่ง', { label: 'สถานะ', right: true }]} minWidth={620}>
                            {rows.map((r) => (
                                <tr key={r.id} onClick={() => setParams({ id: r.id })} className={`cursor-pointer ${selected === r.id ? 'bg-soft' : 'hover:bg-soft/60'}`}>
                                    <td className="font-semibold">{r.code}</td>
                                    <td><Badge>{SOURCE[r.source]}</Badge></td>
                                    <td>{r.itemCount} รายการ</td>
                                    <td className="text-muted">{dateTime(r.submittedAt || r.createdAt)}</td>
                                    <td>{r.tripCode || <span className="text-faint">–</span>}</td>
                                    <td className="text-right">{historyPill(r)}</td>
                                </tr>
                            ))}
                        </Table>
                    )}
                </Card>
                {selected && <RequestPanel id={selected} />}
            </div>
        </>
    )
}

// แผงรายละเอียดด้านขวา: ไทม์ไลน์ + ของที่ส่งมาเทียบกับรับจริง
function RequestPanel({ id }) {
    const navigate = useNavigate()
    const { data: r, error, loading, reload } = useApi(`/requests/${id}`)
    const [cancelling, setCancelling] = useState(false)
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    useEffect(() => {
        setCancelling(false)
        setErr('')
    }, [id])
    useSocket('requests_changed', useCallback(() => reload(), [reload]))
    useSocket('trip_changed', useCallback(() => reload(), [reload]))

    if (loading && !r) return <Card><Loading /></Card>
    if (error) return <Card><ErrorBox>{error}</ErrorBox></Card>

    const issues = r.items.filter((i) => i.qtyReceived != null && (i.qtyDamaged > 0 || i.qtyReceived + i.qtyDamaged < i.qtyApproved))
    const okItems = r.items.length - issues.length
    const st = r.stop

    const steps = [
        { label: r.source === 'auto' ? 'ระบบร่างคำขอ' : r.source === 'hq' ? 'คลังเสนอเติมของ' : 'สาขาสั่งของ', time: dateTime(r.created_at), state: 'done' },
        r.source === 'auto' && { label: 'สาขายืนยันส่งคำขอ', time: r.submitted_at ? time(r.submitted_at) : '', state: r.submitted_at ? 'done' : 'now' },
        r.status === 'cancelled'
            ? { label: 'ยกเลิกแล้ว', time: '', state: 'bad' }
            : r.status === 'rejected'
            ? { label: 'ถูกปฏิเสธ', time: '', state: 'bad' }
            : { label: 'อนุมัติและจองสต็อก', time: r.approved_at ? time(r.approved_at) : '', state: r.approved_at ? 'done' : r.submitted_at ? 'now' : 'todo' },
        !['rejected', 'cancelled'].includes(r.status) && { label: st ? `ส่งกับ ${st.tripCode}` : 'จัดรถส่ง', time: st?.startedAt ? time(st.startedAt) : '', state: st?.startedAt ? 'done' : st ? 'now' : 'todo' },
        !['rejected', 'cancelled'].includes(r.status) && {
            label: r.status === 'received' ? (issues.length ? 'รับของ · ไม่ครบ' : 'รับของครบ') : st?.status === 'arrived' ? 'รถถึงแล้ว · รอนับของ' : 'รับของ',
            time: r.received_at ? time(r.received_at) : st?.arrivedAt ? time(st.arrivedAt) : '',
            state: r.status === 'received' ? (issues.length ? 'bad' : 'done') : st?.status === 'arrived' ? 'now' : 'todo',
        },
    ].filter(Boolean)

    const title = r.status === 'received' ? (issues.length ? `รับไม่ครบ ${issues.length} รายการ` : 'รับของครบ') : REQUEST_STATUS[r.status][0]

    return (
        <Card className="flex h-fit flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="text-xs text-muted">{r.code} · {SOURCE[r.source]}</div>
                    <div className="text-lg font-semibold">{title}</div>
                </div>
                {issues.length > 0 || r.status === 'rejected' ? <Badge tone="danger">มีปัญหา</Badge> : r.priority === 'urgent' && <Badge tone="danger">ด่วน</Badge>}
            </div>
            <Timeline items={steps} />

            <div>
                <div className="flex justify-between border-b border-[#eef0ed] py-2 text-xs text-faint">
                    <span>สินค้า</span>
                    <span>{r.status === 'received' ? 'ส่งมา / รับจริง' : r.approved_at ? 'ขอ / อนุมัติ' : 'จำนวนที่ขอ'}</span>
                </div>
                {(r.status === 'received' ? issues : r.items).map((i) => (
                    <div key={i.productId} className="flex items-center justify-between gap-2 border-b border-[#f0f2ef] py-3 text-sm">
                        <span>{i.name}</span>
                        <span className="flex items-center gap-1.5">
                            <b>{r.status === 'received' ? `${i.qtyApproved} / ${i.qtyReceived}` : i.qtyApproved != null ? `${i.qtyRequested} / ${i.qtyApproved}` : i.qtyRequested}</b>
                            {i.qtyApproved - i.qtyReceived - i.qtyDamaged > 0 && <Badge tone="danger">ขาด {i.qtyApproved - i.qtyReceived - i.qtyDamaged}</Badge>}
                            {i.qtyDamaged > 0 && <Badge tone="warn">เสีย {i.qtyDamaged}</Badge>}
                        </span>
                    </div>
                ))}
                {r.status === 'received' && okItems > 0 && (
                    <div className="flex justify-between py-3 text-sm"><span>{issues.length ? `อีก ${okItems} รายการ` : `ทั้ง ${okItems} รายการ`}</span><span className="text-muted">ครบ</span></div>
                )}
            </div>

            {r.note && <div className="rounded-2xl bg-soft px-3.5 py-3 text-xs">{r.status === 'rejected' ? `เหตุผลที่ปฏิเสธ: ${r.note}` : r.status === 'cancelled' ? `เหตุผลที่ยกเลิก: ${r.note}` : `หมายเหตุ: ${r.note}`}</div>}
            {issues.length > 0 && <div className="rounded-2xl bg-soft px-3.5 py-3 text-xs">ระบบแจ้งคลังเรื่องของขาด/เสียหายให้แล้ว</div>}

            {['draft', 'pending'].includes(r.status) && !cancelling && (
                <>
                    <Button variant={r.status === 'draft' ? 'brand' : 'ghost'} onClick={() => navigate(`/branch/requests/${r.id}/edit`)}>{r.status === 'draft' ? 'ตรวจและยืนยันส่งคลัง' : 'แก้จำนวน'}</Button>
                    <Button variant="danger" onClick={() => { setCancelling(true); setReason('') }}>ยกเลิกคำขอ</Button>
                </>
            )}
            {['draft', 'pending'].includes(r.status) && cancelling && (
                <div className="flex flex-col gap-2">
                    {r.source === 'auto' && <div className="text-xs text-muted">ถ้าสินค้ายังใกล้หมด ระบบจะร่างคำขอใหม่ให้อีกครั้งภายหลัง</div>}
                    <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล (ไม่บังคับ)" className="h-11 rounded-xl border border-line px-3.5 text-sm outline-none focus:border-ink" />
                    {err && <ErrorBox>{err}</ErrorBox>}
                    <div className="flex gap-2.5">
                        <Button variant="ghost" className="flex-1" onClick={() => setCancelling(false)}>ไม่ยกเลิก</Button>
                        <Button
                            variant="danger"
                            className="flex-[2] !border-danger"
                            loading={busy}
                            onClick={async () => {
                                setBusy(true)
                                setErr('')
                                try {
                                    await api.post(`/requests/${r.id}/cancel`, { reason })
                                    setCancelling(false)
                                    await reload()
                                } catch (e) {
                                    setErr(errMsg(e))
                                } finally {
                                    setBusy(false)
                                }
                            }}
                        >
                            ยืนยันยกเลิกคำขอ
                        </Button>
                    </div>
                </div>
            )}
            {st?.status === 'arrived' && r.status === 'in_transit' && <Button variant="brand" size="lg" onClick={() => navigate(`/branch/receive/${r.id}`)}>นับและรับของ</Button>}
            {st && st.status === 'pending' && <Button variant="ghost" onClick={() => navigate(`/branch/track/${st.tripId}`)}>ติดตามรถ</Button>}
        </Card>
    )
}
