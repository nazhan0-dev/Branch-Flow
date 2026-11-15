import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PackagePlus, Sparkles, Store, Warehouse as WarehouseIcon, X } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { baht, num } from '../../lib/format'
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Loading, Modal, Notice, PageHeader, Product, SearchInput, Select, Stepper, Table } from '../../components/ui'

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
    const [adding, setAdding] = useState(false)
    const [added, setAdded] = useState(null) // ผลการเพิ่มสินค้าล่าสุด แสดงเป็นแถบแจ้ง

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
                        <Button variant="chip" onClick={() => setAdding(true)}>+ เพิ่มสินค้า</Button>
                        <Button onClick={() => setBuying({ productId: selected, qty: 100 })}>+ สั่งซื้อเข้าคลัง</Button>
                    </>
                }
            />
            {added && (
                <Notice tone="brand">
                    เพิ่ม <b>{added.name}</b> ({added.sku}) แล้ว · ร่างคำขอล็อตแรกให้ {added.drafted} จาก {added.branches} สาขา รอสาขายืนยันในหน้าคำขอเติมสินค้า
                </Notice>
            )}
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

            <AddProductModal
                open={adding}
                categories={[...new Set(data.map((p) => p.category))]}
                onClose={() => setAdding(false)}
                onDone={(r) => {
                    setAdding(false)
                    setAdded(r)
                    setParams({ product: r.id })
                    refresh()
                }}
            />
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
                <Select
                    ariaLabel="เลือกสินค้า"
                    placeholder="เลือกสินค้า"
                    value={pid}
                    onChange={(v) => setPid(String(v))}
                    options={products.map((p) => ({ value: p.productId, label: `${p.name} · ${p.sku}`, hint: `ว่าง ${num(p.available)}` }))}
                />
                <div className="flex items-center justify-between"><span className="text-sm text-muted">จำนวน</span><Stepper value={qty} min={1} onChange={setQty} /></div>
                <Notice tone="neutral">ในเดโมนี้ ของจะเข้าคลังทันทีเหมือนซัพพลายเออร์ส่งมาถึงแล้ว</Notice>
                <ErrorBox>{err}</ErrorBox>
                <Button size="lg" disabled={!pid} loading={busy} onClick={save}>ยืนยันรับเข้าคลัง</Button>
            </div>
        </Modal>
    )
}

const UNITS = ['ชิ้น', 'ซอง', 'กล่อง', 'ขวด', 'กระป๋อง', 'แผง', 'ถุง', 'แพ็ก']
const NEW_CAT = '__new'
const EMPTY = { sku: '', name: '', category: '', unit: 'ชิ้น', weight: '', price: '', qty: 0, whReorder: 50, reorder: 10, max: 50 }
const BOX = 'flex h-11 w-full items-center rounded-xl border border-line bg-white text-sm transition-shadow focus-within:border-ink/30 focus-within:shadow-[0_0_0_4px_rgba(20,22,20,0.06)]'
const INPUT = 'h-full min-w-0 flex-1 bg-transparent px-3.5 outline-none placeholder:text-faint'

const Field = ({ label, hint, children }) => (
    <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-[#4a4f48]">{label}</span>
        {children}
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </label>
)
// ช่องกรอกพร้อมหน่วยต่อท้ายในกรอบ (กก. / ฿)
const Input = ({ suffix, className = '', ...rest }) => (
    <div className={`${BOX} ${className}`}>
        <input className={INPUT} {...rest} />
        {suffix && <span className="pr-3.5 text-xs text-muted">{suffix}</span>}
    </div>
)
// ปุ่มตัวเลือกเล็ก ๆ (หน่วย / หมวดที่มีอยู่)
const Chip = ({ on, children, ...rest }) => (
    <button type="button" className={`h-8 rounded-[10px] px-3 text-[13px] transition-colors ${on ? 'bg-ink font-semibold text-white' : 'border border-line bg-white hover:bg-soft'}`} {...rest}>
        {children}
    </button>
)
const StepRow = ({ label, sub, value, onChange, min = 0 }) => (
    <div className="flex items-center justify-between gap-3 py-2.5">
        <div className="min-w-0">
            <div className="text-sm">{label}</div>
            {sub && <div className="text-[11px] text-muted">{sub}</div>}
        </div>
        <Stepper value={value} min={min} onChange={onChange} />
    </div>
)
// หัวกลุ่มในหน้าต่าง: ไอคอน + ชื่อ
const Group = ({ icon: Icon, title, children }) => (
    <section className="rounded-2xl border border-[#eef0ed] px-4 pt-3.5 pb-1.5">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-7 place-items-center rounded-lg bg-soft text-muted"><Icon size={15} /></span>
            {title}
        </div>
        {children}
    </section>
)

// Admin เพิ่มสินค้าใหม่: ข้อมูลสินค้า + สต็อกเริ่มต้นในคลัง + จุดสั่ง/สูงสุดที่ใช้กับทุกสาขา
function AddProductModal({ open, categories, onClose, onDone }) {
    const [f, setF] = useState(EMPTY)
    const [newCat, setNewCat] = useState(false) // กำลังพิมพ์หมวดใหม่แทนการเลือกจากรายการ
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    useEffect(() => {
        if (open) {
            setF(EMPTY)
            setNewCat(false)
            setErr('')
        }
    }, [open])
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }))
    // ช่องตัวเลข: รับเฉพาะตัวเลข + จุดทศนิยมจุดเดียว ทศนิยมไม่เกิน dp ตำแหน่ง (พิมพ์อย่างอื่นไม่ติด)
    const setNum = (k, dp) => (e) => {
        const v = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
        if (new RegExp(`^\\d{0,7}(\\.\\d{0,${dp}})?$`).test(v)) setF((x) => ({ ...x, [k]: v }))
    }
    const ready = f.sku.trim() && f.name.trim() && f.category.trim() && f.unit.trim() && Number(f.weight) > 0 && f.price !== '' && f.max > f.reorder

    const save = async () => {
        setBusy(true)
        setErr('')
        try {
            const { data: r } = await api.post('/products', {
                sku: f.sku.trim().toUpperCase(),
                name: f.name,
                category: f.category,
                unit: f.unit,
                weight_kg: Number(f.weight),
                price: Number(f.price),
                qty: f.qty,
                warehouse_reorder_point: f.whReorder,
                reorder_point: f.reorder,
                max_qty: f.max,
            })
            onDone({ ...r, name: f.name.trim() })
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    const unit = f.unit.trim() || 'ชิ้น'
    const customUnit = !UNITS.includes(f.unit)
    // ยังขาดอะไร (แสดงที่แถบล่าง แทนการปล่อยปุ่มเทาเฉย ๆ)
    const missing = [
        !f.sku.trim() && 'รหัส',
        !f.name.trim() && 'ชื่อ',
        !f.category.trim() && 'หมวด',
        !(Number(f.weight) > 0) && 'น้ำหนัก',
        f.price === '' && 'ราคา',
    ].filter(Boolean)
    // แถบช่วงสต็อกสาขา: 0 → จุดสั่ง (เหลือง) → สูงสุด (เขียว)
    const scale = Math.max(f.max, f.reorder, 1) * 1.15
    const lotValue = f.max * (Number(f.price) || 0)

    return (
        <Modal open={open} onClose={onClose} width={780}>
            {/* หัว: ติดด้านบนตอนเลื่อน */}
            <div className="sticky -top-6 z-10 -mx-6 -mt-6 mb-5 flex items-start justify-between gap-3 border-b border-[#f0f2ef] bg-white px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-ink"><PackagePlus size={20} /></span>
                    <div>
                        <div className="text-lg font-semibold">เพิ่มสินค้าใหม่</div>
                        <div className="text-xs text-muted">เพิ่มเข้าคลังกลาง และเปิดให้ทุกสาขาสั่งได้ทันที</div>
                    </div>
                </div>
                <button aria-label="ปิด" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-xl border border-line hover:bg-soft"><X size={18} /></button>
            </div>

            <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
                {/* ซ้าย: ข้อมูลสินค้า */}
                <div className="flex flex-col gap-4">
                    <div className="text-xs font-semibold tracking-wide text-faint">ข้อมูลสินค้า</div>
                    <div className="grid grid-cols-[130px_1fr] gap-3">
                        <Field label="รหัส (SKU)">
                            <Input value={f.sku} onChange={set('sku')} maxLength={10} placeholder="0625" autoFocus className="uppercase" />
                        </Field>
                        <Field label="ชื่อสินค้า">
                            <Input value={f.name} onChange={set('name')} maxLength={120} placeholder="เช่น โยเกิร์ตรสสตรอว์เบอร์รี" />
                        </Field>
                    </div>

                    {/* หมวด: เลือกจาก dropdown · ตัวเลือกสุดท้ายเปลี่ยนเป็นช่องพิมพ์หมวดใหม่ */}
                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-[#4a4f48]">หมวด</span>
                        {newCat || categories.length === 0 ? (
                            <div className="flex gap-2">
                                <Input value={f.category} onChange={set('category')} maxLength={50} placeholder="พิมพ์ชื่อหมวดใหม่" autoFocus={newCat} />
                                {categories.length > 0 && (
                                    <Button variant="ghost" className="h-11 shrink-0" onClick={() => { setNewCat(false); set('category')('') }}>เลือกจากรายการ</Button>
                                )}
                            </div>
                        ) : (
                            <Select
                                ariaLabel="หมวด"
                                placeholder="เลือกหมวด"
                                value={f.category}
                                onChange={(v) => (v === NEW_CAT ? (setNewCat(true), set('category')('')) : set('category')(v))}
                                options={[...categories.map((c) => [c, c]), { value: NEW_CAT, label: '+ เพิ่มหมวดใหม่' }]}
                            />
                        )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-[#4a4f48]">หน่วย</span>
                        <div className="flex flex-wrap gap-1.5">
                            {UNITS.map((u) => <Chip key={u} on={f.unit === u} onClick={() => set('unit')(u)}>{u}</Chip>)}
                            <input
                                value={customUnit ? f.unit : ''}
                                onChange={set('unit')}
                                maxLength={20}
                                placeholder="อื่น ๆ"
                                aria-label="หน่วยอื่น"
                                className={`h-8 w-20 rounded-[10px] border px-2.5 text-[13px] outline-none placeholder:text-faint focus:border-ink/30 ${customUnit && f.unit ? 'border-ink font-semibold' : 'border-dashed border-[#cfd3cd]'}`}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Field label="น้ำหนักต่อหน่วย" hint="ใช้คำนวณน้ำหนักบนรถ">
                            <Input value={f.weight} onChange={setNum('weight', 3)} inputMode="decimal" placeholder="0.25" suffix="กก." />
                        </Field>
                        <Field label="ราคาต่อหน่วย" hint="ใช้คำนวณมูลค่า">
                            <Input value={f.price} onChange={setNum('price', 2)} inputMode="decimal" placeholder="15" suffix="บาท" />
                        </Field>
                    </div>
                </div>

                {/* ขวา: ตั้งค่าสต็อก */}
                <div className="flex flex-col gap-3">
                    <div className="text-xs font-semibold tracking-wide text-faint">ตั้งค่าสต็อก</div>
                    <Group icon={WarehouseIcon} title="คลังกลาง">
                        <StepRow label="จำนวนเริ่มต้น" sub={`${unit}ที่มีในคลังตอนนี้`} value={f.qty} onChange={set('qty')} />
                        <StepRow label="จุดสั่งซื้อเข้าคลัง" sub="ต่ำกว่านี้ขึ้นเตือนให้สั่งซื้อ" value={f.whReorder} onChange={set('whReorder')} />
                    </Group>
                    <Group icon={Store} title="ทุกสาขา">
                        <StepRow label="จุดสั่ง" sub="ต่ำกว่านี้ระบบร่างคำขอให้" value={f.reorder} onChange={set('reorder')} />
                        <StepRow label="สูงสุด" sub="เติมให้ถึงจำนวนนี้" value={f.max} min={1} onChange={set('max')} />
                        {/* ช่วงสต็อกสาขาแบบภาพ */}
                        <div className="pt-1 pb-3">
                            <div className="relative h-2 rounded-full bg-[#eef0ed]">
                                <div className="absolute inset-y-0 left-0 rounded-full bg-warn/70 transition-[width] duration-300" style={{ width: `${(100 * Math.min(f.reorder, f.max)) / scale}%` }} />
                                <div className="absolute inset-y-0 rounded-full bg-brand transition-all duration-300" style={{ left: `${(100 * f.reorder) / scale}%`, width: `${(100 * Math.max(f.max - f.reorder, 0)) / scale}%` }} />
                            </div>
                            <div className="mt-1.5 flex justify-between text-[11px] text-muted">
                                <span><i className="mr-1 inline-block size-2 rounded-full bg-warn/70" />ร่างคำขอเมื่อ ≤ {f.reorder}</span>
                                <span><i className="mr-1 inline-block size-2 rounded-full bg-brand" />เติมถึง {f.max}</span>
                            </div>
                            {f.max <= f.reorder && <div className="mt-1.5 text-xs text-danger-ink">สูงสุดต้องมากกว่าจุดสั่ง</div>}
                        </div>
                    </Group>

                    {/* ผลที่จะเกิดหลังบันทึก */}
                    <div className="flex gap-3 rounded-2xl bg-brand-soft/60 px-4 py-3 text-[13px] text-brand-ink">
                        <Sparkles size={16} className="mt-0.5 shrink-0" />
                        <span>
                            หลังบันทึก ระบบร่างคำขอล็อตแรกให้ทุกสาขา สาขาละ <b>{num(f.max)} {unit}</b>
                            {lotValue > 0 && <> (≈ {baht(lotValue)})</>} รอสาขายืนยันแล้วอนุมัติตามปกติ
                        </span>
                    </div>
                </div>
            </div>

            {/* แถบล่าง: ติดด้านล่างตอนเลื่อน */}
            <div className="sticky -bottom-6 z-10 -mx-6 mt-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#f0f2ef] bg-white px-6 py-4">
                <div className="min-w-0 flex-1 text-xs">
                    {err ? <span className="text-danger-ink">{err}</span> : missing.length ? <span className="text-muted">ยังขาด: {missing.join(' · ')}</span> : <span className="font-semibold text-brand-ink">ข้อมูลครบ พร้อมบันทึก</span>}
                </div>
                <div className="flex gap-2.5">
                    <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
                    <Button disabled={!ready} loading={busy} onClick={save}>บันทึกสินค้า</Button>
                </div>
            </div>
        </Modal>
    )
}
