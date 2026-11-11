import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import api, { errMsg } from '../../api/client'
import { useApi } from '../../lib/useApi'
import { Badge, Button, ErrorBox, Loading, Stepper } from '../../components/ui'

// สาขานับของที่รถส่งมา: นับทีละรายการ แจ้งของขาด/เสียหาย แล้วยืนยันรับ
export default function Receive() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { data: r, error, loading } = useApi(`/requests/${id}`)
    const trip = useApi(r?.stop ? `/trips/${r.stop.tripId}` : null, [r?.stop?.tripId])
    const [good, setGood] = useState({}) // productId → ของดีที่นับได้
    const [bad, setBad] = useState({}) // productId → เสียหาย
    const [showBad, setShowBad] = useState({})
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const [result, setResult] = useState(null)

    if (loading) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>

    const items = r.items.filter((i) => i.qtyApproved > 0)
    const counted = items.filter((i) => good[i.productId] != null)
    const short = counted.filter((i) => good[i.productId] + (bad[i.productId] || 0) < i.qtyApproved)
    const ready = r.status === 'in_transit' && r.stop?.status === 'arrived'

    const pill = (i) => {
        const g = good[i.productId]
        const d = bad[i.productId] || 0
        if (g == null) return <Badge>ยังไม่นับ</Badge>
        const miss = i.qtyApproved - g - d
        if (d > 0) return <Badge tone="warn">เสียหาย {d}{miss > 0 ? ` · ขาด ${miss}` : ''}</Badge>
        if (miss > 0) return <Badge tone="danger">ขาด {miss}</Badge>
        return <Badge tone="brand">ครบ</Badge>
    }

    const confirm = async () => {
        setBusy(true)
        setErr('')
        try {
            const res = await api.post(`/requests/${r.id}/receive`, {
                items: items.map((i) => ({ product_id: i.productId, qty_received: good[i.productId], qty_damaged: bad[i.productId] || 0 })),
            })
            setResult(res.data)
        } catch (e) {
            setErr(errMsg(e))
            setBusy(false)
        }
    }

    if (result || r.status === 'received') {
        return (
            <div className="mx-auto w-full max-w-[480px] space-y-4 pt-6 text-center">
                <div className="mx-auto grid size-16 place-items-center rounded-full bg-brand-soft text-3xl text-brand-ink">✓</div>
                <h1 className="text-2xl font-semibold">รับของเรียบร้อย</h1>
                <p className="text-sm text-muted">{result?.issues?.length ? `แจ้งคลังแล้ว: ${result.issues.join(', ')}` : 'สต็อกสาขาอัปเดตตามจำนวนที่นับแล้ว'}</p>
                <Button size="lg" className="w-full" onClick={() => navigate(`/branch/requests?id=${r.id}`)}>ดูรายละเอียดคำขอ</Button>
            </div>
        )
    }

    return (
        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4">
            <div className="flex items-start gap-3.5">
                <button aria-label="ย้อนกลับ" onClick={() => navigate(-1)} className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-white"><ChevronLeft size={18} /></button>
                <div>
                    <h1 className="text-xl font-semibold">รับของ {r.stop?.tripCode || r.code}</h1>
                    <p className="text-xs text-muted">จากคลังกลาง{trip.data ? ` · คนขับ ${trip.data.driver.name}` : ''}</p>
                </div>
            </div>

            {!ready && <ErrorBox>{r.stop ? 'รถยังไม่ถึงสาขา รอคนขับกด "ถึงสาขาแล้ว" ก่อนจึงจะนับของได้' : 'คำขอนี้ยังไม่ได้อยู่ในเที่ยวส่ง'}</ErrorBox>}

            <div className="rounded-[18px] bg-white p-4">
                <div className="mb-2.5 flex items-center justify-between">
                    <b className="text-sm">นับแล้ว {counted.length} จาก {items.length} รายการ</b>
                    {short.length > 0 && <Badge tone="danger">ขาด {short.length} รายการ</Badge>}
                </div>
                <div className="h-2 overflow-hidden rounded bg-[#f1f3f0]"><div className="h-full rounded bg-brand" style={{ width: `${(100 * counted.length) / (items.length || 1)}%` }} /></div>
            </div>

            <button
                type="button"
                disabled={!ready}
                onClick={() => setGood(Object.fromEntries(items.map((i) => [i.productId, i.qtyApproved - (bad[i.productId] || 0)])))}
                className="h-12 rounded-2xl border border-line bg-white text-sm font-semibold disabled:opacity-40"
            >
                นับครบตามที่ส่งมาทุกรายการ
            </button>

            <div className="rounded-[22px] bg-white px-4">
                {items.map((i) => {
                    const g = good[i.productId]
                    const d = bad[i.productId] || 0
                    const tone = g != null && g + d < i.qtyApproved ? 'danger' : undefined
                    return (
                        <div key={i.productId} className="border-b border-[#f0f2ef] py-4 last:border-0">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold">{i.name}</div>
                                    <div className="text-xs text-muted">{i.sku} · ส่งมา {i.qtyApproved}</div>
                                    <div className="mt-1.5">{pill(i)}</div>
                                </div>
                                <Stepper value={g ?? null} start={i.qtyApproved - d} max={i.qtyApproved - d} tone={tone} onChange={(v) => ready && setGood({ ...good, [i.productId]: v })} />
                            </div>
                            {showBad[i.productId] ? (
                                <div className="mt-3 flex items-center justify-between rounded-xl bg-warn-soft/60 px-3 py-2">
                                    <span className="text-xs font-semibold text-warn-ink">เสียหาย (ไม่เข้าสต็อก)</span>
                                    <Stepper
                                        value={d}
                                        max={i.qtyApproved}
                                        tone={d ? 'warn' : undefined}
                                        onChange={(v) => {
                                            setBad({ ...bad, [i.productId]: v })
                                            if (g != null) setGood({ ...good, [i.productId]: Math.min(g, i.qtyApproved - v) })
                                        }}
                                    />
                                </div>
                            ) : (
                                ready && <button onClick={() => setShowBad({ ...showBad, [i.productId]: true })} className="mt-2 text-xs font-semibold text-warn-ink">+ แจ้งของเสียหาย</button>
                            )}
                        </div>
                    )
                })}
            </div>

            <ErrorBox>{err}</ErrorBox>
            <div className="sticky bottom-20 rounded-[22px] bg-white p-4 text-center md:bottom-4">
                <p className="mb-3 text-xs text-muted">ยืนยันแล้วสต็อกสาขาจะเพิ่มตามจำนวนที่นับ{short.length ? ' · ระบบจะแจ้งคลังเรื่องของขาด' : ''}</p>
                <Button size="lg" className="w-full" disabled={!ready || counted.length < items.length} loading={busy} onClick={confirm}>
                    {counted.length < items.length ? `นับให้ครบก่อน (${items.length - counted.length})` : 'ยืนยันรับของ'}
                </Button>
            </div>
        </div>
    )
}
