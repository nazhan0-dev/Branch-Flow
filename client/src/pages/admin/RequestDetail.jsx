import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { REQUEST_STATUS, SOURCE, dateTime, num } from '../../lib/format'
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, StatusBadge, Stepper, Table } from '../../components/ui'

export default function AdminRequestDetail() {
    const { id } = useParams()
    const { data: r, error, loading, reload } = useApi(`/requests/${id}`)
    const [approve, setApprove] = useState({})
    const [reason, setReason] = useState('')
    const [rejecting, setRejecting] = useState(false)
    const [busy, setBusy] = useState('')
    const [err, setErr] = useState({ message: '', details: null })

    useSocket('requests_changed', useCallback(() => reload(), [reload]))

    // ค่าเริ่มต้น: อนุมัติเท่าที่ขอ แต่ไม่เกินของว่างในคลัง
    useEffect(() => {
        if (r) setApprove(Object.fromEntries(r.items.map((i) => [i.productId, i.qtyApproved ?? Math.min(i.qtyRequested, Math.max(i.warehouseAvailable ?? 0, 0))])))
    }, [r])

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>
    const pending = r.status === 'pending'

    const run = async (key, fn) => {
        setBusy(key)
        setErr({ message: '', details: null })
        try {
            await fn()
            setRejecting(false)
            await reload()
        } catch (e) {
            setErr({ message: errMsg(e), details: e.response?.data?.details })
        } finally {
            setBusy('')
        }
    }

    const doApprove = () => run('approve', () => api.post(`/requests/${r.id}/approve`, { items: r.items.map((i) => ({ product_id: i.productId, qty_approved: approve[i.productId] })) }))
    const doReject = () => run('reject', () => api.post(`/requests/${r.id}/reject`, { reason }))

    return (
        <div className="space-y-5">
            <Link to="/admin/requests" className="inline-flex items-center gap-1 text-sm text-muted"><ArrowLeft size={16} /> คำขอทั้งหมด</Link>
            <PageHeader
                title={<span className="flex flex-wrap items-center gap-2">{r.code} <StatusBadge map={REQUEST_STATUS} value={r.status} />{r.priority === 'urgent' && <Badge tone="danger">ด่วน</Badge>}</span>}
                sub={`${r.branch.name} (${r.branch.code}) · ${SOURCE[r.source]} · ส่งเมื่อ ${dateTime(r.submitted_at || r.created_at)}`}
                actions={
                    pending && (
                        <>
                            <Button variant="danger" onClick={() => setRejecting(!rejecting)}>ปฏิเสธ</Button>
                            <Button variant="brand" loading={busy === 'approve'} onClick={doApprove}>อนุมัติและจองสต็อก</Button>
                        </>
                    )
                }
            />

            {err.message && (
                <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                    {err.message}
                    {Array.isArray(err.details) && (
                        <ul className="mt-1 list-disc pl-5">
                            {err.details.map((d) => <li key={d.productId}>{d.name}: อนุมัติ {d.approved} แต่ว่าง {d.available}</li>)}
                        </ul>
                    )}
                </div>
            )}

            {rejecting && (
                <Card className="flex flex-col gap-3 sm:flex-row">
                    <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลที่ปฏิเสธ (สาขาจะเห็นข้อความนี้)" className="h-11 flex-1 rounded-xl border border-line px-4 text-sm outline-none focus:border-ink" />
                    <Button variant="primary" disabled={!reason.trim()} loading={busy === 'reject'} onClick={doReject}>ยืนยันปฏิเสธ</Button>
                </Card>
            )}
            {r.note && <div className="rounded-xl bg-soft px-4 py-3 text-sm">หมายเหตุ: {r.note}</div>}

            <Card>
                <Table head={['สินค้า', { label: 'สาขามี', right: true }, { label: 'ขอ', right: true }, { label: 'คลังว่าง', right: true }, pending ? 'อนุมัติ' : { label: 'อนุมัติ', right: true }, { label: 'รับจริง', right: true }]}>
                    {r.items.map((i) => {
                        const short = i.warehouseAvailable < i.qtyRequested
                        return (
                            <tr key={i.productId}>
                                <td>
                                    <div className="font-medium">{i.name}</div>
                                    <div className="text-xs text-faint">{i.sku} · จุดสั่งซื้อ {i.reorderPoint ?? '–'} / เพดาน {i.maxQty ?? '–'}</div>
                                </td>
                                <td className={`text-right ${i.branchQty <= 0 ? 'font-semibold text-danger-ink' : 'text-muted'}`}>{i.branchQty ?? '–'}</td>
                                <td className="text-right font-semibold">{num(i.qtyRequested)}</td>
                                <td className="text-right">
                                    <span className={short && pending ? 'font-semibold text-warn-ink' : 'text-muted'}>{num(i.warehouseAvailable)}</span>
                                    {short && pending && <div><Link to={`/admin/warehouse?product=${i.productId}`} className="text-xs underline">ดูการจัดสรร</Link></div>}
                                </td>
                                <td className={pending ? '' : 'text-right'}>
                                    {pending ? <Stepper value={approve[i.productId] ?? 0} max={i.qtyRequested} onChange={(v) => setApprove({ ...approve, [i.productId]: v })} /> : (i.qtyApproved ?? '–')}
                                </td>
                                <td className="text-right">
                                    {i.qtyReceived ?? '–'}
                                    {i.qtyDamaged > 0 && <div className="text-xs text-danger-ink">เสียหาย {i.qtyDamaged}</div>}
                                </td>
                            </tr>
                        )
                    })}
                </Table>
            </Card>
            {r.stop && <p className="text-sm text-muted">อยู่ในเที่ยวส่ง <Link className="underline" to={`/admin/trips/${r.stop.tripId}`}>{r.stop.tripCode}</Link> จุดที่ {r.stop.seq}</p>}
        </div>
    )
}
