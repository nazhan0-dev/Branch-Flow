import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, X } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useAuth } from '../../store/auth'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { num } from '../../lib/format'
import { Badge, Bar, Button, Card, ErrorBox, Loading, Notice, PageHeader, Product, Segmented, Select, Stepper, Table, Tabs } from '../../components/ui'

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

            {msg && <Notice tone="brand">{msg}</Notice>}

            {/* items-start: การ์ดแต่ละใบสูงเท่าเนื้อหา ไม่ยืดตามกัน */}
            <div className="grid items-start gap-4 xl:grid-cols-[1fr_380px]">
                <Card className={`min-w-0 ${tab === 'waste' ? 'hidden xl:block' : ''}`}>
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-lg font-semibold">นับสต็อก</div>
                            <div className="text-xs text-muted">ใส่จำนวนที่นับได้จริงบนชั้น ระบบจะปรับยอดในระบบให้ตรง</div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-[150px]">
                                <div className="mb-1 flex justify-between text-xs text-muted">
                                    <span>นับแล้ว</span>
                                    <b className="text-ink tabular-nums">{done}/{data.length}</b>
                                </div>
                                <Bar pct={(100 * done) / (data.length || 1)} tone={done === data.length ? 'brand' : 'dark'} className="w-full" />
                            </div>
                            {diffs.length > 0 && <Badge tone="warn">ส่วนต่าง {diffs.length}</Badge>}
                        </div>
                    </div>
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
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-muted">
                            {done > 0 ? (
                                <>
                                    ส่วนต่างจะบันทึกเป็นการปรับยอด ·{' '}
                                    <button onClick={() => setCounted({})} className="font-semibold text-ink underline-offset-2 hover:underline">ล้างการนับ</button>
                                </>
                            ) : (
                                'กด + / − หรือพิมพ์จำนวนที่นับได้ แล้วกดบันทึก'
                            )}
                        </span>
                        <Button disabled={!done} loading={saving} onClick={saveCount}>บันทึกการนับ{done > 0 ? ` (${done})` : ''}</Button>
                    </div>
                </Card>

                <WasteForm stock={data} branchId={user.branchId} onSaved={reload} className={tab === 'count' ? 'hidden xl:flex' : 'flex'} />
            </div>
        </>
    )
}

// ช่องกรอกพร้อมป้ายชื่อด้านบน
const Field = ({ label, className = '', children }) => (
    <div className={className}>
        <div className="mb-1.5 text-xs text-muted">{label}</div>
        {children}
    </div>
)

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
        // xl:sticky: เลื่อนหน้าแล้วฟอร์มลอยตาม
        <Card className={`h-fit flex-col gap-3.5 xl:sticky xl:top-5 ${className}`}>
            <div>
                <div className="text-lg font-semibold">บันทึกของเสีย</div>
                <div className="text-xs text-muted">ตัดของหมดอายุหรือเสียหายออกจากสต็อก</div>
            </div>

            <Field label="สินค้า">
                <Select
                    ariaLabel="เลือกสินค้า"
                    placeholder="เลือกสินค้า"
                    value={pid}
                    onChange={(v) => setPid(String(v))}
                    options={stock.map((s) => ({ value: s.productId, label: `${s.name} · ${s.sku}`, hint: `เหลือ ${num(s.qty)}` }))}
                />
                {product && (
                    <div className="mt-1.5 text-xs text-muted">
                        คงเหลือ <b className="text-ink">{num(product.qty)}</b> → <b className={product.qty - qty < 0 ? 'text-danger-ink' : 'text-ink'}>{num(product.qty - qty)}</b> {product.unit} หลังบันทึก
                    </div>
                )}
            </Field>

            <Field label="จำนวน"><Stepper value={qty} min={1} onChange={setQty} /></Field>
            <Field label="เหตุผล"><Segmented full items={REASONS} value={reason} onChange={setReason} /></Field>

            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" maxLength={200} className="h-11 rounded-xl border border-line px-3.5 text-sm outline-none transition-shadow focus:border-ink/30 focus:shadow-[0_0_0_4px_rgba(20,22,20,0.06)]" />
            <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files[0] && setPhoto({ name: e.target.files[0].name, url: URL.createObjectURL(e.target.files[0]) })} />
            {photo ? (
                <div className="relative overflow-hidden rounded-2xl border border-line">
                    <img src={photo.url} alt="รูปหลักฐาน" className="h-[120px] w-full object-cover" />
                    <button aria-label="ลบรูป" onClick={() => setPhoto(null)} className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-white"><X size={16} /></button>
                </div>
            ) : (
                <button type="button" onClick={() => file.current.click()} className="flex h-[60px] items-center justify-center gap-2.5 rounded-2xl border border-dashed border-[#cfd3cd] text-xs text-muted transition-colors hover:border-ink/30 hover:bg-soft">
                    <Camera size={18} />
                    ถ่ายรูปหรือแนบรูปหลักฐาน (ถ้ามี)
                </button>
            )}

            <ErrorBox>{err}</ErrorBox>
            {msg && <Notice tone="brand">{msg}</Notice>}
            <Button disabled={!product} loading={busy} onClick={save}>
                {product ? `ตัด ${product.name} ออก ${num(qty)} ${product.unit}` : 'เลือกสินค้าก่อนบันทึก'}
            </Button>
            <p className="text-center text-[11px] text-faint">แสดงในส่วน "ยอดขายและของเสีย" บนหน้าหลักของสาขา</p>
        </Card>
    )
}
