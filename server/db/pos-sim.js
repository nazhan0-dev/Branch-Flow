/**
 * จำลองเครื่อง POS ของสาขา: ส่งบิลขายสุ่มเข้าระบบเป็นระยะ
 * ใช้ดูว่าสต็อกลดลงเอง → ถึงจุดสั่งซื้อ → ระบบร่างคำขอให้อัตโนมัติ
 *
 *   npm run pos:sim                 (สาขารามอินทรา ทุก 3 วินาที)
 *   npm run pos:sim -- B0218 1500   (รหัสสาขา, ช่วงเวลาเป็นมิลลิวินาที)
 */
try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')) } catch {}
const { query, one, pool } = require('../config/db')

const API = `http://localhost:${process.env.PORT || 8000}/api`
const KEY = process.env.POS_API_KEY
const [code = 'B0218', every = '3000'] = process.argv.slice(2)

const main = async () => {
    if (!KEY) throw new Error('ตั้งค่า POS_API_KEY ใน server/.env ก่อน')
    const branch = await one('SELECT id, name FROM branch WHERE code = ?', [code])
    if (!branch) throw new Error(`ไม่พบสาขา ${code}`)
    const products = await query('SELECT product_id AS id FROM branch_stock WHERE branch_id = ?', [branch.id])
    await pool.end()
    console.log(`POS จำลอง: สาขา${branch.name} ส่งบิลทุก ${every} ms (Ctrl+C เพื่อหยุด)`)

    let n = 0
    setInterval(async () => {
        const picks = [...products].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3))
        const bill = {
            bill_id: `SIM-${code}-${Date.now()}-${n++}`,
            items: picks.map((p) => ({ product_id: p.id, qty: 1 + Math.floor(Math.random() * 4) })),
        }
        try {
            const res = await fetch(`${API}/branches/${branch.id}/sales`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-POS-Key': KEY },
                body: JSON.stringify(bill),
            })
            const body = await res.json()
            console.log(res.status, bill.bill_id, bill.items.map((i) => `#${i.product_id}×${i.qty}`).join(' '), body.draft ? '→ ระบบร่างคำขอเติมของ' : '')
        } catch (e) {
            console.log('ส่งไม่สำเร็จ (server เปิดอยู่ไหม?)', e.message)
        }
    }, Number(every))
}

main().catch((e) => {
    console.error(e.message)
    process.exit(1)
})
