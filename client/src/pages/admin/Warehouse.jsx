import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { baht, num } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Loading, Modal, Notice, PageHeader, Product, SearchInput, Stepper, Table } from '../../components/ui'

// ส่งออกตารางเป็น CSV (เปิดใน Excel ได้ ใส่ BOM ให้ภาษาไทยไม่เพี้ยน)
const exportCsv = (rows) => {
    const head = ['รหัส', 'สินค้า', 'คงคลัง', 'จองแล้ว', 'ว่าง', 'ขอรวม', 'สาขาที่ขอ', 'ขาด']
    const body = rows.map((r) => [r.sku, r.name, r.qty, r.reserved, r.available, r.requested, r.branches, r.shortfall])
    const csv = '﻿' + [head, ...body].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `warehouse-stock-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
}

export default function Warehouse() {
    const [params, setParams] = useSearchParams()
    const { data, error, loading, reload } = useApi('/warehouse/stock')
    const pending = useApi('/requests?status=pending')
    const [q, setQ] = useState('')
    const [buying, setBuying] = useState(null) // { productId, qty }

    const reloadPending = pending.reload
    const refresh = useCallback(() => {
        reload()
        reloadPending()
    }, [reload, reloadPending])
    useSocket('requests_changed', refresh)
    useSocket('trip_changed', refresh)

    // เลือกสินค้าที่ขาดมากที่สุดไว้ก่อน
    const selected = Number(params.get('product')) || data?.find((p) => p.shortfall > 0)?.productId || data?.[0]?.productId
    const rows = useMemo(() => (data || []).filter((p) => !q || `${p.sku} ${p.name}`.toLowerCase().includes(q.toLowerCase())), [data, q])

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>

    const value = data.reduce((t, p) => t + p.qty * Number(p.price || 0), 0)
    const requested = data.reduce((t, p) => t + Number(p.requested), 0)
    const short = data.filter((p) => p.shortfall > 0)
    const below = data.filter((p) => p.belowReorder)

    return (
        <>
            <PageHeader
                title="สต็อกคลังกลาง"
                sub="คลังแจ้งวัฒนะ · รวมคำขอทุกสาขาตามสินค้า"
                actions={
                    <>
                        <Button variant="chip" onClick={() => exportCsv(data)}>ส่งออก Excel</Button>
                        <Button onClick={() => setBuying({ productId: selected, qty: 100 })}>+ สั่งซื้อเข้าคลัง</Button>
                    </>
                }
            />
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Kpi label="สินค้าในคลัง" value={num(data.length)} sub={`มูลค่า ${baht(value)}`} badge={<Badge>SKU</Badge>} />
                <Kpi label="ขอรวมที่รออนุมัติ" value={num(requested)} sub={`ชิ้น จาก ${pending.data?.length ?? 0} คำขอ`} />
                <Kpi label="คลังไม่พอ" value={short.length} sub="สินค้าที่ขอเกินของว่าง" badge={short.length > 0 && <Badge tone="danger">ต้องจัดสรร</Badge>} />
                <Kpi label="ต้องสั่งเข้าคลัง" value={below.length} sub="สินค้า" badge={below.length > 0 && <Badge tone="warn">ต่ำกว่าเกณฑ์</Badge>} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
                <Card className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-lg font-semibold">สินค้าที่สาขาขอ</div>
                        <SearchInput value={q} onChange={setQ} placeholder="ค้นหาสินค้าหรือรหัส" className="w-full sm:w-[260px]" />
                    </div>
                    <Table head={['สินค้า', 'คงคลัง', 'จองแล้ว', 'ขอรวม', 'สาขาที่ขอ', { label: 'ส่วนต่าง', right: true }]} minWidth={620}>
                        {rows.map((p) => (
                            <tr key={p.productId} onClick={() => setParams({ product: p.productId })} className={`cursor-pointer ${p.productId === selected ? 'bg-soft' : 'hover:bg-soft/60'}`}>
                                <td><Product name={p.name} sku={p.sku} /></td>
                                <td>{num(p.qty)}</td>
                                <td>{num(p.reserved)}</td>
                                <td className="font-semibold">{num(p.requested)}</td>
                                <td>{p.branches}{p.urgent > 0 && ` (ด่วน ${p.urgent})`}</td>
                                <td className="text-right">
                                    {p.shortfall > 0 ? <Badge tone="danger">ขาด {num(p.shortfall)}</Badge> : p.belowReorder ? <Badge tone="warn">ต่ำกว่าเกณฑ์</Badge> : <Badge tone="brand">พอ</Badge>}
                                </td>
                            </tr>
                        ))}
                    </Table>
                </Card>
                {selected && <AllocationPanel productId={selected} onBuy={(qty) => setBuying({ productId: selected, qty })} onDone={refresh} />}
            </div>

            <BuyModal state={buying} products={data} onClose={() => setBuying(null)} onDone={() => { setBuying(null); refresh() }} />
        </>
    )
}

// ข้อเสนอการจัดสรรเมื่อของไม่พอ: ด่วนก่อน → สาขาที่เหลือน้อยเทียบเพดาน → ส่งคำขอก่อน
function AllocationPanel({ productId, onBuy, onDone }) {
    const { data: a, error, loading, reload } = useApi(`/warehouse/allocation/${productId}`)
    const [give, setGive] = useState({})
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState(null)
    useSocket('requests_changed', useCallback(() => reload(), [reload]))

    useEffect(() => {
        if (a) setGive(Object.fromEntries(a.plan.map((p) => [p.requestId, p.suggested])))
        setResult(null)
    }, [a])

    if (loading && !a) return <Card><Loading /></Card>
    if (error) return <Card><ErrorBox>{error}</ErrorBox></Card>
    const total = Object.values(give).reduce((t, v) => t + v, 0)
    const shortBy = Math.max(a.requested - a.available, 0)

    // อนุมัติทุกคำขอที่มีสินค้านี้ โดยใช้จำนวนตามการจัดสรร (สินค้าอื่นในคำขอให้เท่าที่ขอ)
    const confirm = async () => {
        setBusy(true)
        const out = []
        for (const p of a.plan) {
            try {
                const { data: r } = await api.get(`/requests/${p.requestId}`)
                await api.post(`/requests/${p.requestId}/approve`, {
                    items: r.items.map((i) => ({ product_id: i.productId, qty_approved: i.productId === productId ? give[p.requestId] : i.qtyRequested })),
                })
                out.push({ ok: true, text: `${p.code} ${p.branchName}` })
            } catch (e) {
                out.push({ ok: false, text: `${p.code} ${p.branchName}: ${errMsg(e)}` })
            }
        }
        setResult(out)
        setBusy(false)
        onDone()
    }

    return (
        <Card className="flex h-fit flex-col gap-3">
            <div>
                <div className="text-xs text-muted">{shortBy ? 'จัดสรรสินค้าที่ไม่พอ' : 'การจัดสรรสินค้า'}</div>
                <div className="text-lg font-semibold">{a.name} {a.sku}</div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-2xl bg-soft px-3.5 py-3"><div className="text-xs text-muted">ว่างในคลัง</div><div className="text-[22px] font-semibold">{num(a.available)}</div></div>
                <div className={`rounded-2xl px-3.5 py-3 ${shortBy ? 'bg-danger-soft text-danger-ink' : 'bg-soft'}`}><div className="text-xs">ขอรวม</div><div className="text-[22px] font-semibold">{num(a.requested)}</div></div>
            </div>
            {a.plan.length === 0 && <Empty>ไม่มีคำขอรออนุมัติสำหรับสินค้านี้</Empty>}
            <div>
                {a.plan.map((p) => (
                    <div key={p.requestId} className="flex items-center justify-between gap-2 border-b border-[#f0f2ef] py-3 last:border-0">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-semibold">
                                <Link to={`/admin/requests/${p.requestId}`} className="hover:underline">{p.branchName}</Link>
                                {p.branchQty <= 0 ? <Badge tone="danger">หมด</Badge> : p.priority === 'urgent' && <Badge tone="danger">ด่วน</Badge>}
                            </div>
                            <div className="text-xs text-muted">ขอ {p.requested}{p.branchQty > 0 ? ` · เหลือ ${p.branchQty}` : ''}</div>
                        </div>
                        {shortBy ? <Stepper value={give[p.requestId] ?? 0} max={p.requested} onChange={(v) => setGive({ ...give, [p.requestId]: v })} /> : <b>{p.suggested}</b>}
                    </div>
                ))}
            </div>
            {a.plan.length > 0 && (
                <div className="flex justify-between text-xs">
                    <span className="text-muted">จัดสรรแล้ว</span>
                    <b className={total > a.available ? 'text-danger-ink' : ''}>{num(total)} / {num(a.available)}</b>
                </div>
            )}
            {result && (
                <Notice tone={result.every((x) => x.ok) ? 'brand' : 'warn'}>
                    {result.map((x) => <div key={x.text}>{x.ok ? '✓ อนุมัติ' : '✗'} {x.text}</div>)}
                </Notice>
            )}
            {a.plan.length > 0 && (
                <Button size="lg" disabled={total > a.available} loading={busy} onClick={confirm}>ยืนยันการจัดสรรและอนุมัติ</Button>
            )}
            {shortBy > 0 && <Button variant="ghost" onClick={() => onBuy(shortBy)}>สั่งซื้อเข้าคลัง {num(shortBy)} ชิ้น</Button>}
            <p className="text-center text-xs text-muted">การอนุมัติจะอนุมัติสินค้าอื่นในคำขอเดียวกันตามจำนวนที่ขอด้วย</p>
        </Card>
    )
}

// เดโม: สร้างใบสั่งซื้อแล้วถือว่าซัพพลายเออร์ส่งของเข้าคลังทันที
function BuyModal({ state, products, onClose, onDone }) {
    const [pid, setPid] = useState('')
    const [qty, setQty] = useState(100)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    useEffect(() => {
        if (state) {
            setPid(String(state.productId || ''))
            setQty(state.qty || 100)
            setErr('')
        }
    }, [state])

    const save = async () => {
        setBusy(true)
        setErr('')
        try {
            await api.post('/warehouse/receive', { product_id: Number(pid), qty, note: 'สั่งซื้อเข้าคลัง (เดโม: รับของทันที)' })
            onDone()
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal open={!!state} onClose={onClose} title="สั่งซื้อเข้าคลัง" width={440}>
            <div className="flex flex-col gap-3">
                <select value={pid} onChange={(e) => setPid(e.target.value)} className="h-11 rounded-xl border border-line bg-white px-3.5 text-sm">
                    <option value="">เลือกสินค้า</option>
                    {products.map((p) => <option key={p.productId} value={p.productId}>{p.name} · {p.sku} (ว่าง {p.available})</option>)}
                </select>
                <div className="flex items-center justify-between"><span className="text-sm text-muted">จำนวน</span><Stepper value={qty} min={1} onChange={setQty} /></div>
                <Notice tone="neutral">ในเดโมนี้ ของจะเข้าคลังทันทีเหมือนซัพพลายเออร์ส่งมาถึงแล้ว</Notice>
                <ErrorBox>{err}</ErrorBox>
                <Button size="lg" disabled={!pid} loading={busy} onClick={save}>ยืนยันรับเข้าคลัง</Button>
            </div>
        </Modal>
    )
}
