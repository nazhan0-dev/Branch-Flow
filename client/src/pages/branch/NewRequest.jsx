import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errMsg } from '../../api/client'
import { useAuth } from '../../store/auth'
import { useApi } from '../../lib/useApi'
import { num, weight as fmtWeight } from '../../lib/format'
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Product, SearchInput, Segmented, Stepper, Table } from '../../components/ui'

// แนะนำ = สูงสุด − คงเหลือ − ของที่กำลังมา (เฉพาะสินค้าที่ต่ำกว่าจุดสั่งซื้อ)
const suggestOf = (s) => (s.status === 'ok' ? 0 : Math.max(s.maxQty - s.qty - s.incoming, 0))

// รอบรถ: สั่งก่อน 15:30 ได้รอบบ่ายวันนี้ หลังจากนั้นได้รอบเช้าพรุ่งนี้ (ค่าประมาณ)
const nextRound = () => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
    return now.getHours() * 60 + now.getMinutes() < 15 * 60 + 30 ? 'รอบบ่ายวันนี้ · ตัดรอบ 15:30' : 'รอบเช้าพรุ่งนี้ · ตัดรอบ 15:30'
}

export default function NewRequest() {
    const user = useAuth((s) => s.user)
    const navigate = useNavigate()
    const stock = useApi(`/branches/${user.branchId}/stock`)
    const products = useApi('/products')
    const [qty, setQty] = useState({})
    const [q, setQ] = useState('')
    const [lowOnly, setLowOnly] = useState(true)
    const [cat, setCat] = useState('')
    const [priority, setPriority] = useState('normal')
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')

    // เติมจำนวนแนะนำให้ตั้งแต่เปิดหน้า แก้ได้ทุกช่อง
    useEffect(() => {
        if (!stock.data) return
        setQty(Object.fromEntries(stock.data.map((s) => [s.productId, suggestOf(s)]).filter(([, v]) => v > 0)))
        if (stock.data.some((s) => s.status === 'out')) setPriority('urgent')
    }, [stock.data])

    const weight = useMemo(() => new Map((products.data || []).map((p) => [p.id, Number(p.weightKg)])), [products.data])
    const cats = [...new Set((stock.data || []).map((s) => s.category))]
    // ไม่มีสินค้าใกล้หมดเลย → แสดงทุกรายการ
    const hasLow = (stock.data || []).some((s) => s.status !== 'ok')
    const rows = useMemo(
        () =>
            (stock.data || []).filter(
                (s) =>
                    (!lowOnly || !hasLow || s.status !== 'ok' || qty[s.productId] > 0) &&
                    (!cat || s.category === cat) &&
                    (!q || `${s.sku} ${s.name}`.toLowerCase().includes(q.toLowerCase()))
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [stock.data, lowOnly, hasLow, cat, q]
    )
    const picked = (stock.data || []).filter((s) => qty[s.productId] > 0)
    const pieces = picked.reduce((t, s) => t + qty[s.productId], 0)
    const tons = picked.reduce((t, s) => t + qty[s.productId] * (weight.get(s.productId) || 0), 0) / 1000

    if (stock.loading) return <Loading />
    if (stock.error) return <ErrorBox>{stock.error}</ErrorBox>

    const submit = async () => {
        setBusy(true)
        setErr('')
        try {
            const res = await api.post('/requests', { items: picked.map((s) => ({ product_id: s.productId, qty: qty[s.productId] })), priority, note })
            navigate(`/branch/requests?id=${res.data.id}`, { replace: true })
        } catch (e) {
            setErr(errMsg(e))
            setBusy(false)
        }
    }

    return (
        <>
            <PageHeader
                title="สั่งสินค้าเข้าสาขา"
                sub={`สาขา${user.name.split(' ').at(-1).replace(/^สาขา/, '')} · ส่งถึงคลังกลาง`}
                actions={<Button variant="chip" onClick={() => navigate('/branch/requests')}>ประวัติคำขอ</Button>}
            />
            <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
                <Card className="min-w-0">
                    <div className="mb-2 flex flex-wrap gap-2.5">
                        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาสินค้า ชื่อ หรือรหัส" className="min-w-[200px] flex-1" />
                        <Button variant={lowOnly ? 'primary' : 'ghost'} onClick={() => setLowOnly(!lowOnly)}>ใกล้หมดก่อน</Button>
                        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-11 rounded-[14px] border border-line bg-white px-3 text-[13px] font-semibold">
                            <option value="">ทุกหมวด</option>
                            {cats.map((c) => <option key={c}>{c}</option>)}
                        </select>
                    </div>
                    <Table head={['สินค้า', 'คงเหลือ', 'จุดสั่ง / สูงสุด', 'แนะนำ', { label: 'จำนวนที่สั่ง', right: true }]} minWidth={600}>
                        {rows.map((s) => (
                            <tr key={s.productId}>
                                <td><Product name={s.name} sku={s.sku} /></td>
                                <td>{s.status === 'ok' ? num(s.qty) : <Badge tone={s.status === 'out' ? 'danger' : 'warn'}>{num(s.qty)}</Badge>}</td>
                                <td className="text-muted">{s.reorderPoint} / {s.maxQty}</td>
                                <td>{suggestOf(s) || <span className="text-faint">–</span>}</td>
                                <td className="text-right"><Stepper value={qty[s.productId] || 0} onChange={(v) => setQty({ ...qty, [s.productId]: v })} /></td>
                            </tr>
                        ))}
                    </Table>
                    <p className="mt-3 text-xs text-muted">จำนวนแนะนำ = สูงสุด − คงเหลือ − ของที่กำลังส่งมา {lowOnly && '· กด "ใกล้หมดก่อน" อีกครั้งเพื่อดูสินค้าทั้งหมด'}</p>
                </Card>

                <Card className="flex h-fit flex-col gap-3">
                    <div className="text-lg font-semibold">คำขอใหม่</div>
                    <div>
                        {picked.length === 0 && <p className="py-4 text-center text-sm text-muted">ยังไม่ได้เลือกสินค้า</p>}
                        {picked.map((s) => (
                            <div key={s.productId} className="flex justify-between border-b border-[#f0f2ef] py-3 text-sm last:border-0">
                                <span>{s.name}</span>
                                <b>{qty[s.productId]}</b>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-muted">รวม {picked.length} รายการ</span>
                        <b>{num(pieces)} ชิ้น · ~{fmtWeight(tons)}</b>
                    </div>
                    <label className="text-xs text-muted">ความเร่งด่วน</label>
                    <Segmented full items={[['normal', 'ปกติ'], ['urgent', 'ด่วน']]} value={priority} onChange={setPriority} />
                    <label className="text-xs text-muted">หมายเหตุถึงคลัง</label>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} rows={3} placeholder="เช่น มีงานวัดหน้าร้านวันเสาร์" className="resize-none rounded-[14px] border border-line px-3.5 py-3 text-sm outline-none placeholder:text-faint focus:border-ink" />
                    <div className="rounded-2xl bg-soft px-3.5 py-3">
                        <div className="text-xs text-muted">คาดว่าจะได้รับ</div>
                        <div className="text-sm font-semibold">{nextRound()}</div>
                    </div>
                    <ErrorBox>{err}</ErrorBox>
                    <Button size="lg" disabled={!picked.length} loading={busy} onClick={submit}>ส่งคำขอ</Button>
                </Card>
            </div>
        </>
    )
}
