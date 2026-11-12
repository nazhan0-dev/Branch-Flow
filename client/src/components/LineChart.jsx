import { useState } from 'react'
import { longDate, num } from '../lib/format'

// ค่าบนแกน: ปัดเป็นเลขกลม ๆ (1 / 2 / 2.5 / 5 × 10^n)
const niceStep = (max, ticks) => {
    const raw = Math.max(max, 1) / ticks
    const pow = 10 ** Math.floor(Math.log10(raw))
    return [1, 2, 2.5, 5, 10].find((s) => s * pow >= raw) * pow
}
const compact = (v) => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e4 ? `${v / 1e3}K` : num(v))
const dayDate = (d) => new Date(`${d}T00:00:00+07:00`)

/**
 * กราฟเส้นรายวัน หลายชุดบนแกนเดียว (หน่วยเดียวกันเท่านั้น ห้ามใช้สองแกน)
 * rows   = [{ day: 'YYYY-MM-DD', <key>: number, ... }] เรียงตามวัน เติมวันที่ไม่มีข้อมูลเป็น 0 มาแล้ว
 * series = [{ key, color, area }] ชุดแรกคือชุดหลัก (มีพื้นสีจาง + จุดตอนชี้)
 * tooltip(row) = เนื้อหาบรรทัดล่างของ tooltip
 */
export default function LineChart({ rows, series, tooltip, todayLabel, ticks = 3, integer = false, ariaLabel = 'กราฟรายวัน' }) {
    const [hover, setHover] = useState(null)
    const W = 640
    const H = 200
    const P = { l: 40, r: 12, t: 12, b: 26 }
    // จำนวนนับ: แกนสูงอย่างน้อยเท่าจำนวนช่อง (0–3) ไม่ให้เหลือแค่ 0 กับ 1 ตอนข้อมูลน้อย
    const max = Math.max(integer ? ticks : 0, ...rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)))
    // integer = ค่าเป็นจำนวนนับ (เช่นเที่ยวส่ง) แกนต้องไม่มีเศษ
    const step = integer ? Math.max(1, Math.ceil(niceStep(max, ticks))) : niceStep(max, ticks)
    const top = Math.max(step * Math.ceil(max / step), step)
    const lines = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
    const last = rows.length - 1
    const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(last, 1)
    const y = (v) => H - P.b - ((Number(v) || 0) / top) * (H - P.t - P.b)
    const path = (k) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r[k])}`).join(' ')
    const every = Math.ceil(rows.length / 8)
    const label = (d, i) =>
        todayLabel && i === last ? todayLabel : dayDate(d).toLocaleDateString('th-TH', rows.length <= 7 ? { weekday: 'short', timeZone: 'Asia/Bangkok' } : { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })
    // hover = วันที่ใกล้เมาส์ที่สุด ตัวเลขเป็นยอดจริงของวันนั้นเสมอ
    // จุด/เส้นประ/กล่องเลื่อนไปวันใหม่แบบนุ่มนวล (transition) จุดเคลื่อนเป็นเส้นตรงตามเส้นกราฟพอดี
    const near = hover
    const h = hover != null ? rows[hover] : null
    const main = series[0]
    const hx = hover != null ? x(hover) : 0
    const SLIDE = 'transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1)'

    return (
        <div className="relative">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                role="img"
                aria-label={ariaLabel}
                onMouseLeave={() => setHover(null)}
                onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    const px = ((e.clientX - r.left) / r.width) * W
                    setHover(Math.max(0, Math.min(last, Math.round(((px - P.l) / (W - P.l - P.r)) * last))))
                }}
            >
                {lines.map((v) => (
                    <g key={v}>
                        <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#f0f2ef" />
                        <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#9aa097">{compact(v)}</text>
                    </g>
                ))}
                {/* key ผูกกับจำนวนวัน: เปลี่ยนช่วง (7 → 30 วัน) แล้ววาดเส้นใหม่ */}
                {series.filter((s) => s.area).map((s) => (
                    <path key={`a-${s.key}-${rows.length}`} className="bl-fade-slow" d={`${path(s.key)} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`} fill={s.color} opacity="0.07" />
                ))}
                {/* วาดชุดหลักทีหลังสุดให้อยู่บน */}
                {[...series].reverse().map((s) => (
                    <path key={`${s.key}-${rows.length}`} className="bl-draw" pathLength="1" d={path(s.key)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {rows.map((r, i) => (i % every === 0 || i === last) && (
                    <text key={r.day} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={near === i ? '#141614' : '#9aa097'}>{label(r.day, i)}</text>
                ))}
                {h && (
                    <>
                        <line x1="0" x2="0" y1={P.t} y2={H - P.b} stroke="#9aa097" strokeDasharray="3 3" style={{ transform: `translateX(${hx}px)`, transition: SLIDE }} />
                        <circle cx="0" cy="0" r="6" fill="#fff" stroke={main.color} strokeWidth="3" style={{ transform: `translate(${hx}px, ${y(h[main.key])}px)`, transition: SLIDE }} />
                    </>
                )}
            </svg>
            {h && (
                <div className="pointer-events-none absolute top-0 rounded-xl border border-line bg-white px-3 py-1.5 text-xs shadow-sm" style={{ left: `clamp(0px, calc(${(hx / W) * 100}% - 70px), calc(100% - 170px))`, transition: 'left 0.28s cubic-bezier(0.2, 0.7, 0.2, 1)' }}>
                    <div className="text-muted">{todayLabel && near === last ? `${todayLabel} (ถึงตอนนี้)` : longDate(dayDate(h.day))}</div>
                    <b>{tooltip(h)}</b>
                </div>
            )}
            {/* ตารางสำหรับโปรแกรมอ่านหน้าจอ */}
            <table className="sr-only">
                <caption>{ariaLabel}</caption>
                <thead><tr><th>วันที่</th>{series.map((s) => <th key={s.key}>{s.label || s.key}</th>)}</tr></thead>
                <tbody>{rows.map((r) => <tr key={r.day}><td>{r.day}</td>{series.map((s) => <td key={s.key}>{Math.round(Number(r[s.key]) || 0)}</td>)}</tr>)}</tbody>
            </table>
        </div>
    )
}

// หัวกราฟแบบในหน้าภาพรวม: จุดสี + ชื่อ + ยอดรวมตัวใหญ่
export const LegendTotals = ({ items }) => (
    <div className="flex gap-6">
        {items.map(([label, color, value]) => (
            <div key={label}>
                <div className="flex items-center gap-1.5 text-xs text-muted"><i className="size-2.5 rounded-full" style={{ background: color }} />{label}</div>
                <div className="text-2xl font-semibold">{value}</div>
            </div>
        ))}
    </div>
)
