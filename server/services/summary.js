const { query, one } = require('../config/db')
const { emit } = require('./realtime')

// แจ้งเตือนของผู้บริหาร = สรุปผลเท่านั้น (ไม่รับแจ้งเตือนงานรายเคสเหมือนคลัง)
//  - สรุปประจำวัน: ของเมื่อวาน สร้างหลังเที่ยงคืน (เวลาไทย)
//  - สรุปประจำสัปดาห์: จันทร์–อาทิตย์ที่ผ่านมา เทียบยอดขายกับสัปดาห์ก่อนหน้า
// link ใช้เป็นกุญแจกันสร้างซ้ำ (/exec?day=… / /exec?week=…)
const BKK_MS = 7 * 3600e3
const DAY_MS = 864e5
const DAYS_BACK = 7
const WEEKS_BACK = 2

const dayStart = (t = Date.now()) => new Date(Math.floor((t + BKK_MS) / DAY_MS) * DAY_MS - BKK_MS)
const dayKey = (d) => new Date(d.getTime() + BKK_MS).toISOString().slice(0, 10)
const thDate = (d, opt) => d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', ...opt })
const baht = (v) => (v >= 1e6 ? `฿${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `฿${(v / 1e3).toFixed(1)}K` : `฿${Math.round(v).toLocaleString('th-TH')}`)

const stats = (from, to) =>
    one(
        `SELECT
           (SELECT COUNT(*) FROM trip WHERE status = 'completed' AND finished_at >= ? AND finished_at < ?) AS trips,
           (SELECT COUNT(*) FROM trip_stop WHERE received_at >= ? AND received_at < ?) AS stops,
           (SELECT ROUND(100 * AVG(arrived_at <= eta + INTERVAL 15 MINUTE)) FROM trip_stop
              WHERE arrived_at >= ? AND arrived_at < ? AND eta IS NOT NULL) AS onTimePct,
           (SELECT COALESCE(SUM(-sm.change * p.price), 0) FROM stock_movement sm JOIN product p ON p.id = sm.product_id
              WHERE sm.reason = 'sale' AND sm.created_at >= ? AND sm.created_at < ?) AS sales,
           (SELECT COALESCE(SUM(-sm.change * p.price), 0) FROM stock_movement sm JOIN product p ON p.id = sm.product_id
              WHERE sm.reason = 'waste' AND sm.created_at >= ? AND sm.created_at < ?)
           + (SELECT COALESCE(SUM(ri.qty_damaged * p.price), 0) FROM request_item ri
              JOIN replenish_request r ON r.id = ri.request_id JOIN product p ON p.id = ri.product_id
              WHERE ri.qty_damaged > 0 AND r.received_at >= ? AND r.received_at < ?) AS waste,
           (SELECT COUNT(*) FROM replenish_request WHERE priority = 'urgent' AND created_at >= ? AND created_at < ?) AS urgent`,
        Array(7).fill([from, to]).flat()
    ).then((s) => ({ ...s, sales: Number(s.sales), waste: Number(s.waste) }))

const idle = (s) => !s.trips && !s.stops && !s.sales && !s.urgent

// ข้อความ: หัวข้อ · ตัวชี้วัด · ตัวชี้วัด (หน้าเว็บแยกหัวข้อกับตัวชี้วัดด้วย " · ")
const metrics = (s, salesTrend) =>
    [
        `ยอดขาย ${baht(s.sales)}${salesTrend ?? ''}`,
        `ส่ง ${s.trips} เที่ยว`,
        s.onTimePct != null && `ตรงเวลา ${s.onTimePct}%`,
        `ของเสีย ${baht(s.waste)}`,
        s.urgent > 0 && `คำขอด่วน ${s.urgent}`,
    ].filter(Boolean)

const trend = (cur, prev) => {
    if (!prev) return ''
    const pct = Math.round((100 * (cur - prev)) / prev)
    return ` (${pct >= 0 ? '+' : ''}${pct}%)`
}

// สร้างสรุปที่ยังไม่มี · live = true เมื่อเรียกจากงานตั้งเวลา (ส่งแจ้งเตือนเด้งให้ผู้บริหารที่เปิดหน้าอยู่)
let running = null
const ensureSummaries = (live = false) => (running ||= build(live).finally(() => (running = null)))

const build = async (live) => {
    const today = dayStart()
    const pending = []

    for (let i = DAYS_BACK; i >= 1; i--) {
        const from = new Date(today.getTime() - i * DAY_MS)
        pending.push({ type: 'daily_summary', link: `/exec?day=${dayKey(from)}`, from, to: new Date(from.getTime() + DAY_MS), order: 0 })
    }
    // จันทร์ล่าสุดที่ผ่านมาแล้ว (สัปดาห์ที่จบแล้ว)
    const dow = (new Date(today.getTime() + BKK_MS).getUTCDay() + 6) % 7 // จันทร์ = 0
    const thisMonday = new Date(today.getTime() - dow * DAY_MS)
    for (let w = WEEKS_BACK; w >= 1; w--) {
        const from = new Date(thisMonday.getTime() - w * 7 * DAY_MS)
        pending.push({ type: 'weekly_summary', link: `/exec?week=${dayKey(from)}`, from, to: new Date(from.getTime() + 7 * DAY_MS), order: 1 })
    }

    const have = new Set((await query('SELECT link FROM notification WHERE role = ? AND link IN (?)', ['executive', pending.map((p) => p.link)])).map((r) => r.link))
    // เรียงตามเวลาสิ้นสุด สรุปสัปดาห์อยู่เหนือสรุปวันอาทิตย์
    const todo = pending.filter((p) => !have.has(p.link)).sort((a, b) => a.to - b.to || a.order - b.order)

    let made = 0
    for (const p of todo) {
        const s = await stats(p.from, p.to)
        if (idle(s)) continue
        let message
        if (p.type === 'daily_summary') {
            message = [`สรุปประจำวัน ${thDate(p.from, { weekday: 'short', day: 'numeric', month: 'short' })}`, ...metrics(s)].join(' · ')
        } else {
            const prev = await stats(new Date(p.from.getTime() - 7 * DAY_MS), p.from)
            const last = new Date(p.to.getTime() - DAY_MS)
            // คร่อมเดือน → ใส่เดือนทั้งสองฝั่ง (26 ต.ค.–1 พ.ย.) ไม่งั้นใส่ท้ายอย่างเดียว (2–8 พ.ย.)
            const sameMonth = thDate(p.from, { month: 'short' }) === thDate(last, { month: 'short' })
            const range = `${thDate(p.from, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })}–${thDate(last, { day: 'numeric', month: 'short' })}`
            message = [`สรุปประจำสัปดาห์ ${range}`, ...metrics(s, trend(s.sales, prev.sales))].join(' · ')
        }
        const createdAt = new Date(p.to.getTime() - 1)
        const res = await query('INSERT INTO notification SET ?', [{ role: 'executive', type: p.type, message: message.slice(0, 255), link: p.link, created_at: createdAt }])
        if (live) emit('exec', 'notification', { id: res.insertId, type: p.type, message, link: p.link, createdAt: createdAt.toISOString() })
        made++
    }
    return made
}

module.exports = { ensureSummaries }
