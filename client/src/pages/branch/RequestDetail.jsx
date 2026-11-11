import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { SOURCE, countdown, dateTime, minutesUntil, num } from '../../lib/format'
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Product, Segmented, Stepper, Table } from '../../components/ui'

// แก้จำนวนในร่าง/คำขอที่ยังไม่อนุมัติ แล้วยืนยันส่งคลัง
export default function RequestDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { data: r, error, loading } = useApi(`/requests/${id}`)
    const [qty, setQty] = useState({})
    const [priority, setPriority] = useState('normal')
    const [busy, setBusy] = useState('')
    const [err, setErr] = useState('')

    useEffect(() => {
        if (!r) return
        setQty(Object.fromEntries(r.items.map((i) => [i.productId, i.qtyRequested])))
        setPriority(r.priority)
    }, [r])

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>
    if (!['draft', 'pending'].includes(r.status)) return <Navigate to={`/branch/requests?id=${r.id}`} replace />

    const items = r.items.map((i) => ({ product_id: i.productId, qty: qty[i.productId] ?? i.qtyRequested }))
    const total = items.reduce((t, i) => t + i.qty, 0)

    const run = async (key, submit) => {
        setBusy(key)
        setErr('')
        try {
            await api.patch(`/requests/${r.id}`, { items, priority })
            if (submit) await api.post(`/requests/${r.id}/submit`)
            navigate(`/branch/requests?id=${r.id}`)
        } catch (e) {
            setErr(errMsg(e))
            setBusy('')
        }
    }

    return (
        <>
            <PageHeader
                title={`${r.status === 'draft' ? 'ตรวจร่างคำขอ' : 'แก้คำขอ'} ${r.code}`}
                sub={`${SOURCE[r.source]} · สร้าง ${dateTime(r.created_at)}${r.status === 'draft' && r.auto_submit_at ? ` · ส่งเข้าคลังอัตโนมัติในอีก ${countdown(minutesUntil(r.auto_submit_at))}` : ''}`}
                actions={<Button variant="chip" onClick={() => navigate(-1)}>ย้อนกลับ</Button>}
            />
            <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
                <Card className="min-w-0">
                    <Table head={['สินค้า', 'คงเหลือตอนนี้', 'จุดสั่ง / สูงสุด', { label: 'จำนวนที่ขอ', right: true }]} minWidth={560}>
                        {r.items.map((i) => (
                            <tr key={i.productId}>
                                <td><Product name={i.name} sku={i.sku} /></td>
                                <td>{i.branchQty <= 0 ? <Badge tone="danger">{i.branchQty ?? 0}</Badge> : i.branchQty <= i.reorderPoint ? <Badge tone="warn">{i.branchQty}</Badge> : i.branchQty}</td>
                                <td className="text-muted">{i.reorderPoint ?? '–'} / {i.maxQty ?? '–'}</td>
                                <td className="text-right"><Stepper value={qty[i.productId] ?? 0} onChange={(v) => setQty({ ...qty, [i.productId]: v })} /></td>
                            </tr>
                        ))}
                    </Table>
                    <p className="mt-3 text-xs text-muted">ตั้งจำนวนเป็น 0 เพื่อเอารายการออก · ระบบคำนวณจำนวนเริ่มต้นจาก สูงสุด − คงเหลือ</p>
                </Card>
                <Card className="flex h-fit flex-col gap-3">
                    <div className="text-lg font-semibold">สรุป</div>
                    <div className="flex justify-between text-sm"><span className="text-muted">รวม {items.filter((i) => i.qty > 0).length} รายการ</span><b>{num(total)} ชิ้น</b></div>
                    <label className="text-xs text-muted">ความเร่งด่วน</label>
                    <Segmented full items={[['normal', 'ปกติ'], ['urgent', 'ด่วน']]} value={priority} onChange={setPriority} />
                    <ErrorBox>{err}</ErrorBox>
                    {r.status === 'draft' ? (
                        <>
                            <Button variant="brand" size="lg" loading={busy === 'submit'} onClick={() => run('submit', true)}>ยืนยันส่งคำขอ</Button>
                            <Button variant="ghost" loading={busy === 'save'} onClick={() => run('save', false)}>บันทึกไว้ก่อน</Button>
                        </>
                    ) : (
                        <Button size="lg" loading={busy === 'save'} onClick={() => run('save', false)}>บันทึกการแก้ไข</Button>
                    )}
                </Card>
            </div>
        </>
    )
}
