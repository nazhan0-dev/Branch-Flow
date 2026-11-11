// สร้างยอดขายและของเสียย้อนหลังให้ทุกสาขา (ข้อมูลตัวอย่างสำหรับกราฟใน Dashboard)
// ของเสียตัวอย่างบันทึกเป็น reason = 'waste', ref_type = 'hist'
// ใช้งาน: npm run db:sales            (30 วันย้อนหลังจนถึงตอนนี้)
//        npm run db:sales -- 60      (ระบุจำนวนวัน)
//
// - ใส่เฉพาะ "ประวัติ" (pos_sale + stock_movement) ไม่แตะสต็อกคงเหลือของสาขา
// - บิลที่สร้างขึ้นต้นด้วย HIST- รันซ้ำได้: ลบชุดเดิมก่อนแล้วสร้างใหม่ (บิลจริงจาก POS ไม่ถูกแตะ)
// - สุ่มแบบกำหนด seed ผลลัพธ์จึงเหมือนเดิมทุกครั้งที่รันวันเดียวกัน
try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')) } catch {}
const mysql = require('mysql2/promise')

const BKK_MS = 7 * 3600e3
const DAY_MS = 864e5
const PREFIX = 'HIST-'

// สัดส่วนความนิยมของสินค้าตาม SKU (ตัวที่ไม่อยู่ในรายการใช้ 1)
const POPULAR = { '0112': 6, '0301': 4, '0087': 3, '0155': 3, '0140': 2.5, '0091': 2, '0520': 2, '0231': 1.5, '0004': 1.2, '0412': 0.8 }
// คนซื้อเยอะช่วงไหนของวัน (ชั่วโมงไทย → น้ำหนัก)
const HOURS = { 7: 3, 8: 4, 9: 2, 10: 2, 11: 3, 12: 5, 13: 3, 14: 2, 15: 2, 16: 3, 17: 5, 18: 6, 19: 5, 20: 3, 21: 2 }
// อา–ส: เสาร์อาทิตย์ขายดีกว่า
const WEEKDAY = [1.25, 0.9, 0.9, 0.95, 1, 1.1, 1.3]
// ของเสีย: ของสด/อายุสั้นเสียบ่อยกว่า, สาเหตุ [ข้อความต้น note (ต้องตรงกับ API), น้ำหนัก]
const PERISHABLE = { '0412': 5, '0231': 5, '0091': 4, '0087': 3, '0520': 2, '0004': 1, '0140': 0.5, '0155': 0.5, '0301': 0.5, '0112': 0.5 }
const WASTE_WHY = [['หมดอายุ', 65], ['เสียหาย', 30], ['อื่น ๆ', 5]]

// PRNG แบบมี seed (mulberry32)
const rng = (seed) => () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pickWeighted = (rand, entries) => {
    const total = entries.reduce((s, [, w]) => s + w, 0)
    let r = rand() * total
    for (const [v, w] of entries) if ((r -= w) <= 0) return v
    return entries.at(-1)[0]
}

const seedSales = async (conn, days = 30) => {
    const [branches] = await conn.query('SELECT id, code FROM branch WHERE is_warehouse = 0 ORDER BY id')
    const [products] = await conn.query('SELECT id, sku FROM product')
    const productW = products.map((p) => [p.id, POPULAR[p.sku] || 1])
    const hourW = Object.entries(HOURS).map(([h, w]) => [Number(h), w])

    const wasteW = products.map((p) => [p.id, PERISHABLE[p.sku] ?? 1])
    const [staff] = await conn.query("SELECT id, branch_id FROM user WHERE role = 'branch'")
    const staffOf = Object.fromEntries(staff.map((u) => [u.branch_id, u.id]))

    await conn.query("DELETE FROM stock_movement WHERE reason = 'sale' AND ref_type = 'bill' AND note LIKE ?", [`${PREFIX}%`])
    await conn.query('DELETE FROM pos_sale WHERE bill_id LIKE ?', [`${PREFIX}%`])
    await conn.query("DELETE FROM stock_movement WHERE reason = 'waste' AND ref_type = 'hist'")
    let wastes = 0

    const now = Date.now()
    const todayBkk = Math.floor((now + BKK_MS) / DAY_MS) * DAY_MS // เที่ยงคืนเวลาไทย (ในหน่วยเวลาไทย)
    let bills = 0
    let lines = 0

    for (const [bi, b] of branches.entries()) {
        // สาขาขนาดต่างกัน: 25–70 บิลต่อวัน
        const size = 25 + ((bi * 17) % 46)
        const sales = []
        const moves = []
        for (let d = days - 1; d >= 0; d--) {
            const dayBkk = todayBkk - d * DAY_MS
            const dayKey = new Date(dayBkk).toISOString().slice(0, 10)
            const rand = rng(b.id * 100003 + Math.floor(dayBkk / DAY_MS))
            const weekday = new Date(dayBkk).getUTCDay()
            const n = Math.round(size * WEEKDAY[weekday] * (0.85 + rand() * 0.3))
            for (let i = 0; i < n; i++) {
                const hour = pickWeighted(rand, hourW)
                const soldAt = dayBkk + hour * 3600e3 + Math.floor(rand() * 3600e3) - BKK_MS // กลับเป็น UTC
                if (soldAt > now) continue // วันนี้: สร้างถึงแค่ตอนนี้
                const billId = `${PREFIX}${b.code}-${dayKey.replaceAll('-', '')}-${String(i + 1).padStart(3, '0')}`
                const items = new Map()
                const count = 1 + Math.floor(rand() * 3)
                for (let k = 0; k < count; k++) {
                    const pid = pickWeighted(rand, productW)
                    items.set(pid, (items.get(pid) || 0) + 1 + Math.floor(rand() * 2))
                }
                const at = new Date(soldAt)
                sales.push([billId, b.id, [...items.values()].reduce((s, q) => s + q, 0), at, at])
                for (const [pid, qty] of items) moves.push([b.id, pid, -qty, 'sale', 'bill', billId, null, at])
            }
            // ของเสียวันละ 0–2 รายการ ตอนปิดร้าน (21:00–22:00)
            const nWaste = rand() < 0.35 ? 0 : rand() < 0.7 ? 1 : 2
            for (let k = 0; k < nWaste; k++) {
                const at = dayBkk + 21 * 3600e3 + Math.floor(rand() * 3600e3) - BKK_MS
                if (at > now) continue
                const why = pickWeighted(rand, WASTE_WHY)
                moves.push([b.id, pickWeighted(rand, wasteW), -(1 + Math.floor(rand() * 4)), 'waste', 'hist', why, staffOf[b.id] ?? null, new Date(at)])
                wastes++
            }
        }
        for (let i = 0; i < sales.length; i += 1000) {
            await conn.query('INSERT INTO pos_sale (bill_id, branch_id, total_items, sold_at, received_at) VALUES ?', [sales.slice(i, i + 1000)])
        }
        for (let i = 0; i < moves.length; i += 1000) {
            await conn.query('INSERT INTO stock_movement (branch_id, product_id, `change`, reason, ref_type, note, user_id, created_at) VALUES ?', [moves.slice(i, i + 1000)])
        }
        bills += sales.length
        lines += moves.length
    }
    return { branches: branches.length, bills, lines, wastes }
}

module.exports = { seedSales }

if (require.main === module) {
    const days = Math.min(Math.max(Number(process.argv[2]) || 30, 1), 365)
    ;(async () => {
        const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL || 'mysql://root@localhost:3306/branch_logistics', timezone: 'Z' })
        await conn.query("SET time_zone = '+00:00'")
        const r = await seedSales(conn, days)
        await conn.end()
        console.log(`สร้างประวัติย้อนหลัง ${days} วัน: ${r.branches} สาขา, ${r.bills.toLocaleString()} บิล, ของเสีย ${r.wastes.toLocaleString()} รายการ (ไม่แตะสต็อกคงเหลือ)`)
    })().catch((err) => {
        console.error(err)
        process.exit(1)
    })
}
