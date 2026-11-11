import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronLeft } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useAuth } from '../../store/auth'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { REQUEST_STATUS, SOURCE, countdown, minutesUntil, num, time } from '../../lib/format'
import TripMap from '../../components/TripMap'
import SalesCard from '../../components/SalesCard'
import { Badge, Bar, Button, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, Product, Table } from '../../components/ui'

// ป้ายสถานะของสินค้าแต่ละตัวในตารางสต็อก
export const stockPill = (r) => {
    if (r.incoming > 0) return <Badge tone="danger">กำลังมา {num(r.incoming)}</Badge>
    if (r.requestStatus === 'draft') return <Badge tone="warn">ร่างคำขอ</Badge>
    if (r.requestStatus === 'pending') return <Badge tone="warn">รออนุมัติ</Badge>
    if (r.status === 'out') return <Badge tone="danger">หมด</Badge>
    if (r.status === 'low') return <Badge tone="warn">ใกล้หมด</Badge>
    return <Badge tone="brand">ปกติ</Badge>
}
export const levelTone = (r) => (r.status === 'out' ? 'danger' : r.status === 'low' ? 'warn' : 'brand')

/**
 * Dashboard ของสาขา
 * - พนักงานสาขา: ไม่ส่ง props ใช้สาขาของตัวเอง
 * - Admin / ผู้บริหาร: ส่ง branchId + viewer ('admin' | 'executive') ดูอย่างเดียว ไม่มีปุ่มที่เป็นงานของสาขา
 */
export default function BranchDashboard({ branchId: viewBranchId, viewer }) {
    const user = useAuth((s) => s.user)
    const navigate = useNavigate()
    const branchId = viewBranchId ?? user.branchId
    const base = viewer === 'executive' ? '/exec' : '/admin'
    const dash = useApi(`/dashboard/branch/${branchId}`)
    const stock = useApi(`/branches/${branchId}/stock`)
    const branches = useApi('/branches')
    const [trip, setTrip] = useState(null)
    const [filter, setFilter] = useState('all')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    const reloadDash = dash.reload
    const reloadStock = stock.reload
    const refresh = useCallback(() => {
        reloadDash()
        reloadStock()
    }, [reloadDash, reloadStock])
    useSocket('stock_changed', refresh)
    useSocket('requests_changed', refresh)
    useSocket('trip_changed', refresh)
    useSocket('notification', refresh)

    const tripId = dash.data?.incoming?.tripId
    useEffect(() => {
        if (!tripId) return setTrip(null)
        api.get(`/trips/${tripId}`).then((r) => setTrip(r.data)).catch(() => setTrip(null))
    }, [tripId, dash.data])
    useSocket('truck_location', useCallback((p) => setTrip((t) => (t && t.id === p.tripId ? { ...t, lastLocation: p } : t)), []))

    const rows = useMemo(() => (stock.data || []).filter((r) => filter === 'all' || r.status === filter), [stock.data, filter])

    if (dash.loading || stock.loading) return <Loading />
    if (dash.error || stock.error) return <ErrorBox>{dash.error || stock.error}</ErrorBox>
    const { branch, stock: s, outNames, draft, incoming, recent, onTime } = dash.data
    const me = (branches.data || []).find((b) => b.id === branchId)
    const counts = { low: stock.data.filter((r) => r.status === 'low').length, out: stock.data.filter((r) => r.status === 'out').length }

    const confirmDraft = async () => {
        setBusy(true)
        setErr('')
        try {
            await api.post(`/requests/${draft.id}/submit`)
            refresh()
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    const etaMin = incoming?.eta ? minutesUntil(incoming.eta) : null
    const pct = onTime.total ? Math.round((100 * onTime.onTime) / onTime.total) : null

    return (
        <>
            <PageHeader
                title={`สาขา${branch.name}`}
                sub={`สาขา #${branch.code.replace(/^B/, '')} · ${branch.region} · อัปเดต ${time(new Date())}`}
                actions={
                    viewer ? (
                        <Button variant="chip" onClick={() => navigate(`${base}/branches`)}><ChevronLeft size={16} /> ทุกสาขา</Button>
                    ) : (
                        <>
                            <Button variant="chip" onClick={() => navigate('/branch/stock?tab=waste')}>บันทึกของเสีย</Button>
                            <Button variant="chip" onClick={() => navigate('/branch/stock')}>นับสต็อก</Button>
                            <Button onClick={() => navigate('/branch/order')}>+ สั่งสินค้า</Button>
                        </>
                    )
                }
            />

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi label="สินค้าใกล้หมด" value={num(s.lowItems)} sub={`จาก ${num(s.totalItems)} รายการในสาขา`} badge={s.lowItems > 0 && <Badge tone="warn">ต้องเติม</Badge>} />
                <Kpi label="หมดแล้ว" value={num(s.outItems)} sub={outNames.length ? outNames.map((o) => `${o.name} ${o.sku}`).join(', ') : 'ไม่มีสินค้าหมด'} badge={s.outItems > 0 && <Badge tone="danger">ด่วน</Badge>} />
                <Kpi
                    label="ของกำลังมา"
                    value={incoming?.eta ? time(incoming.eta) : '–'}
                    sub={incoming ? (incoming.stopStatus === 'arrived' ? 'รถถึงแล้ว · รอนับของ' : `${incoming.itemCount} รายการ${etaMin != null ? ` · อีก ${countdown(etaMin)}` : ' · รอออกจากคลัง'}`) : 'ไม่มีรถที่กำลังมา'}
                    badge={incoming && <Badge tone="brand">{incoming.code}</Badge>}
                />
                <Kpi label="ส่งตรงเวลา 30 วัน" value={pct == null ? '–' : `${pct}%`} sub={onTime.total ? `${onTime.onTime} จาก ${onTime.total} เที่ยว` : 'ยังไม่มีข้อมูล'} />
            </div>

            {draft && (
                <div className="flex flex-wrap items-center gap-4 rounded-[22px] bg-ink px-5 py-4 text-white">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-warn text-ink"><AlertTriangle size={20} /></span>
                    <div className="min-w-0 flex-1">
                        <div className="font-semibold">ระบบร่างคำขอเติมสินค้าให้ {draft.itemCount} รายการ</div>
                        <div className="text-xs text-[#b9beb7]">
                            {viewer
                                ? `รอสาขายืนยัน${draft.autoSubmitAt ? ` · ระบบจะส่งเข้าคลังเองใน ${countdown(minutesUntil(draft.autoSubmitAt))}` : ''}`
                                : draft.autoSubmitAt ? `ถ้าไม่ยืนยัน ระบบจะส่งเข้าคลังเองใน ${countdown(minutesUntil(draft.autoSubmitAt))}` : 'ตรวจจำนวนแล้วกดยืนยันเพื่อส่งเข้าคลัง'}
                        </div>
                    </div>
                    {!viewer && (
                        <>
                            <Button variant="soft" onClick={() => navigate(`/branch/requests/${draft.id}/edit`)}>แก้จำนวน</Button>
                            <Button variant="brand" loading={busy} onClick={confirmDraft}>ยืนยันส่งคำขอ</Button>
                        </>
                    )}
                </div>
            )}
            <ErrorBox>{err}</ErrorBox>

            <div className="grid gap-4 xl:grid-cols-[1fr_468px]">
                <Card className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-lg font-semibold">สต็อกสินค้า</div>
                        <div className="flex gap-1.5">
                            {[
                                ['all', 'ทั้งหมด', 'neutral'],
                                ['low', `ใกล้หมด ${counts.low}`, 'warn'],
                                ['out', `หมด ${counts.out}`, 'danger'],
                            ].map(([k, label, tone]) => (
                                <button key={k} onClick={() => setFilter(k)} className={`rounded-lg ${filter === k ? 'ring-2 ring-ink/70' : ''}`}>
                                    <Badge tone={tone}>{label}</Badge>
                                </button>
                            ))}
                        </div>
                    </div>
                    <Table head={['สินค้า', 'คงเหลือ', 'จุดสั่ง / สูงสุด', 'ระดับ', { label: 'สถานะ', right: true }]} minWidth={560}>
                        {rows.map((r) => (
                            <tr key={r.productId}>
                                <td><Product name={r.name} sku={r.sku} /></td>
                                <td className="font-semibold">{num(r.qty)}</td>
                                <td className="text-muted">{r.reorderPoint} / {r.maxQty}</td>
                                <td><Bar pct={(100 * r.qty) / (r.maxQty || 1)} tone={levelTone(r)} /></td>
                                <td className="text-right">{stockPill(r)}</td>
                            </tr>
                        ))}
                    </Table>
                    {rows.length === 0 && <Empty>ไม่มีสินค้าในกลุ่มนี้</Empty>}
                </Card>

                <div className="flex min-w-0 flex-col gap-4">
                    <TripMap trip={trip} branches={trip || !me ? [] : [me]} className="h-[190px]" zoomControl={false}>
                        <button
                            onClick={() => navigate(viewer ? (trip ? `${base}/trips/${trip.id}` : `${base}/trips`) : trip ? `/branch/track/${trip.id}` : '/branch/track')}
                            className="absolute bottom-3.5 left-3.5 z-[500] rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white"
                        >
                            {trip ? `${trip.code} · ${incoming?.stopStatus === 'arrived' ? 'ถึงแล้ว' : incoming?.eta ? `ถึง ${time(incoming.eta)}` : 'รอออกรถ'}` : 'ยังไม่มีรถที่กำลังมา'}
                        </button>
                    </TripMap>

                    {!viewer && incoming?.stopStatus === 'arrived' && (
                        <Button variant="brand" size="lg" onClick={() => navigate(`/branch/receive/${incoming.requestId}`)}>รถถึงแล้ว · นับและรับของ</Button>
                    )}

                    <Card className="flex-1">
                        <div className="mb-1 flex items-center justify-between">
                            <div className="text-lg font-semibold">คำขอล่าสุด</div>
                            {!viewer && <Link to="/branch/requests" className="text-xs text-muted underline">ดูทั้งหมด</Link>}
                        </div>
                        {recent.length === 0 && <Empty>ยังไม่มีคำขอ</Empty>}
                        {recent.map((r) => {
                            const body = (
                                <>
                                    <div>
                                        <div className="font-semibold">{r.code}</div>
                                        <div className="text-xs text-muted">{r.itemCount} รายการ · {SOURCE[r.source]}</div>
                                    </div>
                                    {r.status === 'received' && r.shortItems > 0 ? <Badge>รับแล้ว · ขาด {r.shortItems}</Badge> : <Badge tone={REQUEST_STATUS[r.status][1]}>{REQUEST_STATUS[r.status][0]}</Badge>}
                                </>
                            )
                            const cls = 'flex items-center justify-between gap-3 border-b border-[#f0f2ef] py-3 last:border-0'
                            // ผู้บริหารไม่มีหน้าคำขอ → แสดงอย่างเดียว ไม่เป็นลิงก์
                            if (viewer === 'executive') return <div key={r.id} className={cls}>{body}</div>
                            return <Link key={r.id} to={viewer ? `/admin/requests/${r.id}` : `/branch/requests?id=${r.id}`} className={cls}>{body}</Link>
                        })}
                    </Card>
                </div>
            </div>

            <SalesCard branchId={branchId} />
        </>
    )
}
