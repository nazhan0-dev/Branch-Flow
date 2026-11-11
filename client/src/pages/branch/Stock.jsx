import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, X } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useAuth } from '../../store/auth'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { num } from '../../lib/format'
import { Badge, Button, Card, ErrorBox, Loading, Notice, PageHeader, Product, Segmented, Stepper, Table, Tabs } from '../../components/ui'

const REASONS = [
    ['expired', 'หมดอายุ'],
    ['damaged', 'เสียหาย'],
    ['other', 'อื่น ๆ'],
]

// หน้า "นับสต็อกและของเสีย" — นับจริงเทียบกับยอดในระบบ + บันทึกของเสีย
export default function BranchStock() {
    const user = useAuth((s) => s.user)
    const [params, setParams] = useSearchParams()
    const tab = params.get('tab') === 'waste' ? 'waste' : 'count'
    const { data, error, loading, reload } = useApi(`/branches/${user.branchId}/stock`)
    const [counted, setCounted] = useState({}) // productId → จำนวนที่นับ (ยังไม่นับ = ไม่มี key)
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState('')
    const [err, setErr] = useState('')

    useSocket('stock_changed', useCallback(() => reload(), [reload]))

    const diffs = useMemo(() => (data || []).filter((r) => counted[r.productId] != null && counted[r.productId] !== r.qty), [data, counted])
    const done = Object.keys(counted).length

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>

    const saveCount = async () => {
        setSaving(true)
        setErr('')
        try {
            const items = data.filter((r) => counted[r.productId] != null).map((r) => ({ product_id: r.productId, counted: counted[r.productId] }))
            const res = await api.post(`/branches/${user.branchId}/stock-count`, { items })
            setMsg(`บันทึกการนับแล้ว ${items.length} รายการ · ปรับยอด ${res.data.adjusted} รายการ`)
            setCounted({})
            reload()
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setSaving(false)
        }
    }

    const diffPill = (r) => {
        const c = counted[r.productId]
        if (c == null) return <Badge>ยังไม่นับ</Badge>
        const d = c - r.qty
        return d === 0 ? <Badge tone="brand">ตรง</Badge> : <Badge tone={d < 0 ? 'danger' : 'warn'}>{d > 0 ? `+${d}` : d}</Badge>
    }

    return (
        <>
            <PageHeader
                title="นับสต็อกและของเสีย"
                sub={`สาขา${user.name.split(' ').at(-1).replace(/^สาขา/, '')} · ปรับยอดให้ตรงกับของบนชั้น`}
                actions={<Tabs items={[['count', 'นับสต็อก'], ['waste', 'บันทึกของเสีย']]} value={tab} onChange={(k) => setParams(k === 'waste' ? { tab: 'waste' } : {})} />}
            />

            <Notice>
                <div className="flex flex-wrap justify-between gap-2">
                    <span>
                        <b className="text-ink">นับแล้ว {done} จาก {data.length} รายการ · พบส่วนต่าง {diffs.length} รายการ</b>{' '}
                        <span className="text-muted">ระบบจะบันทึกเป็นการปรับยอด (adjust)</span>
                    </span>
                    {done > 0 && <button onClick={() => setCounted({})} className="font-semibold text-ink">ล้างการนับ</button>}
                </div>
            </Notice>
            {msg && <Notice tone="brand">{msg}</Notice>}

            <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
                <Card className={`min-w-0 ${tab === 'waste' ? 'hidden xl:block' : ''}`}>
                    <Table head={['สินค้า', 'ในระบบ', 'นับจริง', { label: 'ส่วนต่าง', right: true }]} minWidth={520}>
                        {data.map((r) => {
                            const c = counted[r.productId]
                            const tone = c == null || c === r.qty ? undefined : c < r.qty ? 'danger' : 'warn'
                            return (
                                <tr key={r.productId}>
                                    <td><Product name={r.name} sku={r.sku} /></td>
                                    <td>{num(r.qty)}</td>
                                    <td>
                                        <Stepper value={c ?? null} start={Math.max(r.qty, 0)} tone={tone} onChange={(v) => setCounted({ ...counted, [r.productId]: v })} />
                                    </td>
                                    <td className="text-right">{diffPill(r)}</td>
                                </tr>
                            )
                        })}
                    </Table>
                    <ErrorBox>{err}</ErrorBox>
                    <div className="mt-4 flex justify-end">
                        <Button size="lg" className="w-full sm:w-[220px]" disabled={!done} loading={saving} onClick={saveCount}>บันทึกการนับ</Button>
                    </div>
                </Card>

                <WasteForm stock={data} branchId={user.branchId} onSaved={reload} className={tab === 'count' ? 'hidden xl:flex' : 'flex'} />
            </div>
        </>
    )
}

function WasteForm({ stock, branchId, onSaved, className }) {
    const [pid, setPid] = useState('')
    const [qty, setQty] = useState(1)
    const [reason, setReason] = useState('expired')
    const [note, setNote] = useState('')
    const [photo, setPhoto] = useState(null)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const [msg, setMsg] = useState('')
    const file = useRef(null)

    useEffect(() => () => photo && URL.revokeObjectURL(photo.url), [photo])
    const product = stock.find((s) => s.productId === Number(pid))

    const save = async () => {
        setBusy(true)
        setErr('')
        setMsg('')
        try {
            await api.post(`/branches/${branchId}/waste`, { product_id: Number(pid), qty, reason, note: [note, photo && `แนบรูป ${photo.name}`].filter(Boolean).join(' · ') })
            setMsg(`ตัด ${product.name} ออก ${qty} ${product.unit} แล้ว`)
            setQty(1)
            setNote('')
            setPhoto(null)
            onSaved()
        } catch (e) {
            setErr(errMsg(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card className={`h-fit flex-col gap-3 ${className}`}>
            <div className="text-lg font-semibold">บันทึกของเสีย</div>
            <label className="text-xs text-muted">สินค้า</label>
            <select value={pid} onChange={(e) => setPid(e.target.value)} className="h-11 rounded-xl border border-line bg-white px-3.5 text-sm">
                <option value="">เลือกสินค้า</option>
                {stock.map((s) => (
                    <option key={s.productId} value={s.productId}>{s.name} · {s.sku} (เหลือ {s.qty})</option>
                ))}
            </select>
            <label className="text-xs text-muted">จำนวน</label>
            <Stepper value={qty} min={1} onChange={setQty} />
            <label className="text-xs text-muted">เหตุผล</label>
            <Segmented items={REASONS} value={reason} onChange={setReason} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" maxLength={200} className="h-11 rounded-xl border border-line px-3.5 text-sm outline-none focus:border-ink" />
            <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files[0] && setPhoto({ name: e.target.files[0].name, url: URL.createObjectURL(e.target.files[0]) })} />
            {photo ? (
                <div className="relative overflow-hidden rounded-2xl border border-line">
                    <img src={photo.url} alt="รูปหลักฐาน" className="h-[130px] w-full object-cover" />
                    <button aria-label="ลบรูป" onClick={() => setPhoto(null)} className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-white"><X size={16} /></button>
                </div>
            ) : (
                <button type="button" onClick={() => file.current.click()} className="flex h-[110px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#cfd3cd] text-xs text-muted">
                    <Camera size={22} />
                    ถ่ายรูปหรือแนบรูปหลักฐาน
                </button>
            )}
            <p className="text-xs text-muted">ของเสียจะตัดออกจากสต็อก และนับในส่วน "ยอดขายและของเสีย" บนหน้าหลักของสาขา (เดโมนี้เก็บแค่ชื่อไฟล์รูปไว้ในหมายเหตุ)</p>
            <ErrorBox>{err}</ErrorBox>
            {msg && <Notice tone="brand">{msg}</Notice>}
            <Button variant="ghost" size="lg" disabled={!product} loading={busy} onClick={save}>บันทึกของเสีย</Button>
        </Card>
    )
}
