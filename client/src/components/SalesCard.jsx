import { useCallback, useState } from 'react'
import { useApi } from '../lib/useApi'
import { useSocket } from '../lib/socket'
import { baht, dateTime, num } from '../lib/format'
import { Badge, Bar, Card, Empty, ErrorBox, Segmented } from './ui'
import LineChart, { LegendTotals } from './LineChart'

const RANGES = [
    ['7', '7 วัน'],
    ['14', '14 วัน'],
    ['30', '30 วัน'],
]
const SALES_COLOR = '#22a45d'
const WASTE_COLOR = '#9aa097'
// สาเหตุของเสีย: [ชื่อ, สีป้าย]
const KIND = {
    expired: ['หมดอายุ', 'warn'],
    damaged: ['เสียหายในสาขา', 'danger'],
    transit: ['เสียหายตอนรับของ', 'danger'],
    other: ['อื่น ๆ', 'neutral'],
}

// % เปลี่ยนแปลงเทียบช่วงก่อนหน้า (goodWhenUp=false เช่นของเสีย ยิ่งลดยิ่งดี)
const Delta = ({ cur, prev, goodWhenUp = true }) => {
    if (!Number(prev)) return null
    const d = ((Number(cur) - Number(prev)) / Number(prev)) * 100
    if (Math.abs(d) < 0.5) return <Badge>คงที่</Badge>
    const good = goodWhenUp ? d > 0 : d < 0
    return <Badge tone={good ? 'brand' : 'danger'}>{d > 0 ? '+' : '−'}{Math.abs(d).toFixed(0)}%</Badge>
}

const Stat = ({ label, value, sub, badge }) => (
    <div className="min-w-0 rounded-2xl bg-soft px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span className="truncate">{label}</span>
            {badge}
        </div>
        <div className="mt-1 truncate text-2xl font-semibold">{value}</div>
        <div className="truncate text-xs text-muted">{sub}</div>
    </div>
)

/** ยอดขายและของเสียของสาขา: ตัวเลขสรุป + กราฟเส้นรายวัน + สินค้าขายดี + สรุปของเสีย */
export default function SalesCard({ branchId }) {
    const [days, setDays] = useState('7')
    const { data, error, loading, reload } = useApi(`/dashboard/branch/${branchId}/sales?days=${days}`)
    const refresh = useCallback((p) => (!p?.branchId || p.branchId === branchId) && reload(), [branchId, reload])
    useSocket('stock_changed', refresh)
    useSocket('trip_changed', refresh) // รับของ (อาจมีของเสียหายตอนรับ)

    return (
        <Card className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-lg font-semibold">ยอดขายและของเสีย</div>
                    <div className="text-xs text-muted">จากบิล POS และการบันทึกของเสีย · มูลค่าคิดตามราคาสินค้าปัจจุบัน</div>
                </div>
                <Segmented items={RANGES} value={days} onChange={setDays} />
            </div>

            <ErrorBox>{error}</ErrorBox>
            {loading && !data && <div className="h-[260px] animate-pulse rounded-2xl bg-soft" />}
            {data && <Body data={data} />}
        </Card>
    )
}

function Body({ data }) {
    const { today, yesterdaySameTime: y, period, prevPeriod, daily, topProducts, waste, days } = data
    const perBill = today.bills ? today.revenue / today.bills : 0
    const wastePct = period.revenue ? (100 * waste.value) / period.revenue : null
    const empty = !period.units && !waste.units

    return (
        <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="ยอดขายวันนี้" value={baht(today.revenue)} sub={`เมื่อวานช่วงเดียวกัน ${baht(y.revenue)}`} badge={<Delta cur={today.revenue} prev={y.revenue} />} />
                <Stat label="บิลวันนี้" value={num(today.bills)} sub={`เฉลี่ย ${baht(perBill)} / บิล`} badge={<Delta cur={today.bills} prev={y.bills} />} />
                <Stat label={`ยอดขาย ${days} วัน`} value={baht(period.revenue)} sub={`${num(period.units)} ชิ้น · ${num(period.bills)} บิล`} badge={<Delta cur={period.revenue} prev={prevPeriod.revenue} />} />
                <Stat
                    label={`ของเสีย ${days} วัน`}
                    value={baht(waste.value)}
                    sub={`${num(waste.units)} ชิ้น${wastePct != null ? ` · ${wastePct.toFixed(1)}% ของยอดขาย` : ''}`}
                    badge={<Delta cur={waste.value} prev={waste.prevValue} goodWhenUp={false} />}
                />
            </div>

            {empty ? (
                <Empty>ยังไม่มียอดขายหรือของเสียในช่วงนี้ · ลองรัน <code>npm run pos:sim</code> หรือ <code>npm run db:sales</code> ฝั่ง server</Empty>
            ) : (
                <>
                    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
                        <div className="min-w-0">
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="font-semibold">ยอดขายและของเสียรายวัน</div>
                                    <div className="text-xs text-muted">หน่วยบาท · ของเสียรวมทั้งในสาขาและตอนรับของจากรถ</div>
                                </div>
                                <LegendTotals items={[['ยอดขาย', SALES_COLOR, baht(period.revenue)], ['ของเสีย', WASTE_COLOR, baht(waste.value)]]} />
                            </div>
                            <LineChart
                                rows={daily}
                                series={[{ key: 'revenue', label: 'ยอดขาย (บาท)', color: SALES_COLOR, area: true }, { key: 'waste', label: 'ของเสีย (บาท)', color: WASTE_COLOR }]}
                                tooltip={(r) => `${baht(r.revenue)} ยอดขาย · ของเสีย ${baht(r.waste)}`}
                                todayLabel="วันนี้"
                                ariaLabel="กราฟยอดขายและของเสียรายวัน"
                            />
                        </div>
                        <div className="min-w-0">
                            <div className="mb-3 font-semibold">สินค้าขายดี {days} วัน</div>
                            <Ranked rows={topProducts} valueKey="revenue" tone="brand" empty="ยังไม่มียอดขาย" />
                        </div>
                    </div>

                    <div className="grid gap-5 border-t border-[#f0f2ef] pt-4 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr]">
                        <WasteByKind waste={waste} />
                        <div className="min-w-0">
                            <div className="mb-3 font-semibold">สินค้าที่เสียบ่อย {days} วัน</div>
                            <Ranked rows={waste.top} valueKey="value" tone="dark" empty="ไม่มีของเสียในช่วงนี้" />
                        </div>
                        <RecentWaste rows={waste.recent} />
                    </div>
                </>
            )}
        </>
    )
}

// รายการเรียงอันดับ: ชื่อ + มูลค่า + จำนวน + แถบเทียบอันดับหนึ่ง
function Ranked({ rows, valueKey, tone, empty }) {
    if (!rows.length) return <Empty>{empty}</Empty>
    const max = Number(rows[0][valueKey]) || 1
    return (
        <div className="flex flex-col gap-3">
            {rows.map((p, i) => (
                <div key={p.productId}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate"><b className="font-semibold">{p.name}</b> <span className="text-muted">{p.sku}</span></span>
                        <span className="shrink-0 text-right"><b>{baht(p[valueKey])}</b> <span className="text-xs text-muted">{num(p.units)} {p.unit}</span></span>
                    </div>
                    <Bar pct={(100 * Number(p[valueKey])) / max} tone={i === 0 ? tone : 'gray'} className="w-full" />
                </div>
            ))}
        </div>
    )
}

function WasteByKind({ waste }) {
    const total = waste.value || 1
    const rows = Object.entries(KIND).map(([k, [label]]) => [k, label, waste.byKind[k]])
    return (
        <div className="min-w-0">
            <div className="mb-3 font-semibold">สาเหตุของเสีย</div>
            {!waste.units ? (
                <Empty>ไม่มีของเสียในช่วงนี้</Empty>
            ) : (
                <div className="flex flex-col gap-3">
                    {rows.map(([k, label, v]) => (
                        <div key={k}>
                            <div className="mb-1.5 flex justify-between gap-2 text-sm">
                                <span>{label}</span>
                                <span><b>{baht(v.value)}</b> <span className="text-xs text-muted">{num(v.units)} ชิ้น · {Math.round((100 * v.value) / total)}%</span></span>
                            </div>
                            <Bar pct={(100 * v.value) / total} tone={k === 'expired' ? 'warn' : k === 'other' ? 'gray' : 'danger'} className="w-full" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function RecentWaste({ rows }) {
    return (
        <div className="min-w-0">
            <div className="mb-1 font-semibold">บันทึกของเสียล่าสุด</div>
            {!rows.length && <Empty>ยังไม่มีการบันทึกของเสีย</Empty>}
            {rows.map((r, i) => {
                const [label, tone] = KIND[r.kind] || KIND.other
                // note ของในสาขา = "สาเหตุ · หมายเหตุ" แสดงเฉพาะส่วนหมายเหตุ
                const extra = r.note?.split(' · ').slice(1).join(' · ')
                return (
                    <div key={i} className="flex items-start justify-between gap-3 border-b border-[#f0f2ef] py-2.5 text-sm last:border-0">
                        <div className="min-w-0">
                            <div className="truncate"><b className="font-semibold">{r.name}</b> × {num(r.qty)} {r.unit}</div>
                            <div className="truncate text-xs text-muted">
                                {dateTime(r.at)}
                                {r.requestCode ? ` · รับของ ${r.requestCode}` : r.byName ? ` · ${r.byName}` : ''}
                                {extra ? ` · ${extra}` : ''}
                            </div>
                        </div>
                        <Badge tone={tone}>{label}</Badge>
                    </div>
                )
            })}
        </div>
    )
}
