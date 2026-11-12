import { useCallback, useMemo, useState } from 'react'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { baht, num, time } from '../../lib/format'
import { Badge, Bar, Button, Card, CountUp, Empty, ErrorBox, Kpi, Loading, PageHeader, Select, useSeen } from '../../components/ui'
import LineChart, { LegendTotals } from '../../components/LineChart'

const RANGES = [7, 30, 90]

// ป้ายเปลี่ยนแปลงเทียบช่วงก่อนหน้า (goodWhenUp=false เช่นเวลาส่ง ยิ่งลดยิ่งดี)
const Delta = ({ cur, prev, unit = '%', goodWhenUp = true, points }) => {
    if (cur == null || prev == null || (!points && !Number(prev))) return null
    const d = points ? Number(cur) - Number(prev) : ((Number(cur) - Number(prev)) / Number(prev)) * 100
    if (!Number.isFinite(d) || Math.abs(d) < 0.05) return <Badge>คงที่</Badge>
    const good = goodWhenUp ? d > 0 : d < 0
    return <Badge tone={good ? 'brand' : 'danger'}>{d > 0 ? '+' : '−'}{Math.abs(d).toFixed(points ? 1 : 0)}{unit}</Badge>
}

// รายงาน CSV สำหรับส่งต่อ (เปิดใน Excel ได้)
const exportReport = (data) => {
    const k = data.kpi
    const lines = [
        ['รายงานภาพรวมการกระจายสินค้า', `${data.days} วันล่าสุด`],
        [],
        ['ตัวชี้วัด', 'ค่า'],
        ['เที่ยวส่ง', k.trips],
        ['ส่งตรงเวลา (%)', k.onTimePct ?? ''],
        ['เวลาส่งเฉลี่ย (ชม.)', k.avgDeliveryHours ?? ''],
        ['สาขาที่ของหมด', `${k.branchesOut}/${k.branchCount}`],
        ['มูลค่าที่กระจาย (บาท)', k.valueDelivered],
        [],
        ['ภาค', 'สาขา', 'เที่ยวส่ง', 'ตรงเวลา (%)'],
        ...data.regions.map((r) => [r.region, r.branches, r.trips, r.onTimePct ?? '']),
    ]
    const csv = '﻿' + lines.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `overview-${data.days}d-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
}

export default function Overview() {
    const [days, setDays] = useState(7)
    const { data, error, loading, reload, updatedAt } = useApi(`/dashboard/overview?days=${days}`, [], { poll: 60000 })
    const refresh = useCallback(() => reload(), [reload])
    useSocket('trip_changed', refresh)
    useSocket('requests_changed', refresh)

    if (loading && !data) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>
    const { kpi, prev, requestsToday, frequentOut, dailyTrips, regions, vehicles } = data
    const totalTrips = dailyTrips.reduce((t, d) => t + d.trips, 0)
    const totalLate = dailyTrips.reduce((t, d) => t + Number(d.late), 0)

    return (
        <>
            <PageHeader
                title="ภาพรวมการกระจายสินค้า"
                sub={`ข้อมูลทุกสาขา อัปเดตล่าสุด ${time(updatedAt)}`}
                actions={
                    <>
                        <Select variant="pill" ariaLabel="ช่วงเวลา" value={days} onChange={(v) => setDays(Number(v))} options={RANGES.map((d) => [d, `${d} วันล่าสุด`])} align="right" />
                        <Button onClick={() => exportReport(data)}>ส่งออกรายงาน</Button>
                    </>
                }
            />

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                <Kpi label={`เที่ยวส่ง ${days} วัน`} value={num(kpi.trips)} sub={`ช่วงก่อนหน้า ${num(prev.trips)} เที่ยว · กำลังวิ่ง ${kpi.onRoute}`} badge={<Delta cur={kpi.trips} prev={prev.trips} />} />
                <Kpi label="ส่งตรงเวลา" value={kpi.onTimePct == null ? '–' : `${kpi.onTimePct}%`} sub="ถึงไม่เกิน ETA + 15 นาที" badge={<Delta cur={kpi.onTimePct} prev={prev.onTimePct} points />} />
                <Kpi label="เวลาส่งเฉลี่ย" value={kpi.avgDeliveryHours == null ? '–' : `${kpi.avgDeliveryHours} ชม.`} sub="จากคลังถึงสาขารับของ" badge={<Delta cur={kpi.avgDeliveryHours} prev={prev.avgDeliveryHours} goodWhenUp={false} />} />
                <Kpi label="สาขาที่ของหมด" value={num(kpi.branchesOut)} sub={`จาก ${kpi.branchCount} สาขา · รออนุมัติ ${kpi.pendingRequests} คำขอ`} badge={kpi.branchesOut > 0 && <Badge tone="danger">ติดตาม</Badge>} />
                <Kpi label="มูลค่าที่กระจาย" value={baht(kpi.valueDelivered)} sub={`${days} วันล่าสุด`} badge={<Delta cur={kpi.valueDelivered} prev={prev.valueDelivered} />} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
                <Card className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-lg font-semibold">เที่ยวส่งและการส่งล่าช้า</div>
                            <div className="text-xs text-muted">ล่าช้า = ถึงสาขาช้ากว่า ETA เกิน 15 นาที</div>
                        </div>
                        <LegendTotals items={[['เที่ยวส่ง', '#22a45d', num(totalTrips)], ['ล่าช้า', '#cfd3cd', num(totalLate)]]} />
                    </div>
                    <TripsChart days={days} rows={dailyTrips} />
                </Card>
                <Card>
                    <div className="text-lg font-semibold">สาขาที่ของหมดบ่อย</div>
                    <div className="mb-3 text-xs text-muted">จำนวนคำขอด่วน (มีสินค้าหมด) ใน {days} วัน</div>
                    {frequentOut.length === 0 && <Empty>ไม่มีสาขาที่ของหมดในช่วงนี้</Empty>}
                    {frequentOut.map((b, i) => (
                        <div key={b.id} className="mb-3">
                            <div className="mb-1.5 flex justify-between text-sm"><span>{b.name}</span><b><CountUp value={b.times} /></b></div>
                            <Bar pct={(100 * b.times) / frequentOut[0].times} tone={i < 2 ? 'dark' : 'gray'} className="w-full" />
                        </div>
                    ))}
                </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[280px_1fr_1.3fr]">
                <Fleet vehicles={vehicles} />
                <RequestMix rows={requestsToday} />
                <Card className="min-w-0 lg:col-span-2 xl:col-span-1">
                    <div className="mb-2 text-lg font-semibold">ผลงานรายภาค</div>
                    <table className="w-full text-[13px]">
                        <thead>
                            <tr className="border-b border-[#eef0ed] text-faint">
                                <th className="py-2 text-left font-medium">ภาค</th>
                                <th className="py-2 text-right font-medium">สาขา</th>
                                <th className="py-2 text-right font-medium">เที่ยวส่ง</th>
                                <th className="py-2 text-right font-medium">ตรงเวลา</th>
                            </tr>
                        </thead>
                        <tbody>
                            {regions.map((r) => (
                                <tr key={r.region} className="border-b border-[#f0f2ef] last:border-0">
                                    <td className="py-2.5">{r.region}</td>
                                    <td className="text-right">{r.branches}</td>
                                    <td className="text-right">{r.trips}</td>
                                    <td className="text-right">{r.onTimePct == null ? <span className="text-faint">–</span> : <Badge tone={r.onTimePct >= 95 ? 'brand' : r.onTimePct >= 90 ? 'warn' : 'danger'}>{r.onTimePct}%</Badge>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            </div>
        </>
    )
}

// กราฟเส้น 2 ชุด (เที่ยวส่ง / ล่าช้า) เติมวันที่ไม่มีข้อมูลเป็น 0
function TripsChart({ days, rows }) {
    const series = useMemo(() => {
        const map = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]))
        const out = []
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(Date.now() + 7 * 3600e3 - i * 864e5).toISOString().slice(0, 10)
            const r = map.get(d)
            out.push({ day: d, trips: r ? Number(r.trips) : 0, late: r ? Number(r.late) : 0 })
        }
        return out
    }, [days, rows])
    return (
        <LineChart
            rows={series}
            series={[{ key: 'trips', label: 'เที่ยวส่ง', color: '#22a45d', area: true }, { key: 'late', label: 'ล่าช้า', color: '#cfd3cd' }]}
            tooltip={(r) => `${r.trips} เที่ยวส่ง · ล่าช้า ${r.late}`}
            integer
            ariaLabel="กราฟเที่ยวส่งและการส่งล่าช้ารายวัน"
        />
    )
}

// วงแหวน: สัดส่วนรถที่กำลังใช้งานตอนนี้
function Fleet({ vehicles }) {
    const total = vehicles.reduce((t, v) => t + v.n, 0)
    const used = vehicles.find((v) => v.status === 'in_use')?.n || 0
    const pct = total ? Math.round((100 * used) / total) : 0
    const C = 2 * Math.PI * 78
    const [ref, seen] = useSeen()
    return (
        <Card className="flex flex-col">
            <div className="text-lg font-semibold">อัตราการใช้รถ</div>
            {/* วงแหวนวิ่งจาก 0 + ตัวเลขนับขึ้น ตอนเลื่อนมาเห็น */}
            <div ref={ref} className="relative mx-auto my-4 size-[190px]">
                <svg viewBox="0 0 190 190" className="-rotate-90">
                    <circle cx="95" cy="95" r="78" fill="none" stroke="#eef0ed" strokeWidth="20" />
                    <circle
                        cx="95" cy="95" r="78" fill="none" stroke="#22a45d" strokeWidth="20" strokeLinecap="round"
                        strokeDasharray={`${seen ? (C * pct) / 100 : 0} ${C}`}
                        opacity={seen && pct > 0 ? 1 : 0}
                        style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.2s' }}
                    />
                </svg>
                <div className="absolute inset-0 grid place-content-center text-center">
                    <div className="text-[34px] font-semibold"><CountUp value={`${pct}%`} duration={1100} /></div>
                    <div className="text-xs text-muted">ใช้งานอยู่ {used}/{total} คัน</div>
                </div>
            </div>
        </Card>
    )
}

function RequestMix({ rows }) {
    const n = (s) => rows.filter((r) => s.includes(r.status)).reduce((t, r) => t + r.n, 0)
    const parts = [
        ['รับของแล้ว', n(['received']), 'bg-brand'],
        ['กำลังจัดส่ง', n(['approved', 'in_transit']), 'bg-ink'],
        ['รออนุมัติ', n(['pending']), 'bg-warn'],
        ['ร่างอัตโนมัติ', n(['draft']), 'bg-[#e3e6e1]'],
    ]
    const total = rows.reduce((t, r) => t + r.n, 0)
    const [ref, seen] = useSeen()
    return (
        <Card>
            <div className="text-lg font-semibold">สถานะคำขอเติมสินค้าวันนี้</div>
            <div className="mb-4 text-xs text-muted">{total} คำขอจากทุกสาขา{n(['rejected']) ? ` · ปฏิเสธ ${n(['rejected'])}` : ''}</div>
            {/* แถบสัดส่วน: แต่ละช่วงขยายออกทีละช่วงตอนเลื่อนมาเห็น */}
            <div ref={ref} className="mb-5 flex h-4 gap-1 overflow-hidden rounded-md bg-[#f1f3f0]">
                {total > 0 &&
                    parts.map(([l, v, c], i) =>
                        v > 0 && <div key={l} className={c} style={{ width: seen ? `${(100 * v) / total}%` : 0, transition: `width 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) ${i * 120}ms` }} />
                    )}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                {parts.map(([l, v, c]) => (
                    <div key={l}>
                        <div className="flex items-center gap-1.5 text-xs text-muted"><i className={`size-2.5 rounded-full ${c}`} />{l}</div>
                        <div className="text-2xl font-semibold"><CountUp value={v} /></div>
                    </div>
                ))}
            </div>
        </Card>
    )
}
