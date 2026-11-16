// สร้างตารางใหม่ทั้งหมดและใส่ข้อมูลตัวอย่าง  ⚠️ ข้อมูลเดิมในฐานข้อมูลจะหายทั้งหมด
// ใช้งาน: npm run db:reset        (ชุดเต็ม 14 สาขา)
//        npm run db:small        (ชุดเล็ก 2 สาขา 3 สินค้า สำหรับทำความเข้าใจ flow)
//        npm run db:empty        (เริ่มใหม่: คลังกลาง + สาขาบางนา/บางบอน + บัญชี Admin, ผู้บริหาร, สาขา 2, คนขับ 2 ไม่มีสินค้า/รถ)
try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')) } catch {}
const fs = require('fs')
const path = require('path')
const mysql = require('mysql2/promise')
const bcrypt = require('bcryptjs')
const { seedSales } = require('./seed-sales')

const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@1234'

// [code, ชื่อ, ภาค, ที่อยู่, lat, lng, isWarehouse]
const BRANCHES = [
    ['WH01', 'คลังกลาง แจ้งวัฒนะ', 'กรุงเทพฯ และปริมณฑล', 'ถ.แจ้งวัฒนะ ปากเกร็ด นนทบุรี', 13.9036, 100.528, 1],
    ['B0218', 'รามอินทรา', 'กรุงเทพฯ และปริมณฑล', 'ถ.รามอินทรา กม.4 บางเขน', 13.8735, 100.6146, 0],
    ['B0204', 'บางเขน', 'กรุงเทพฯ และปริมณฑล', 'ถ.พหลโยธิน บางเขน', 13.8732, 100.5951, 0],
    ['B0231', 'มีนบุรี', 'กรุงเทพฯ และปริมณฑล', 'ถ.สีหบุรานุกิจ มีนบุรี', 13.8139, 100.73, 0],
    ['B0240', 'หนองจอก', 'กรุงเทพฯ และปริมณฑล', 'ถ.เลียบวารี หนองจอก', 13.855, 100.862, 0],
    ['B0252', 'ลาดกระบัง', 'กรุงเทพฯ และปริมณฑล', 'ถ.ลาดกระบัง ลาดกระบัง', 13.727, 100.776, 0],
    ['B0110', 'ปากเกร็ด', 'กรุงเทพฯ และปริมณฑล', 'ถ.ติวานนท์ ปากเกร็ด', 13.913, 100.498, 0],
    ['B0115', 'บางบัวทอง', 'กรุงเทพฯ และปริมณฑล', 'ถ.กาญจนาภิเษก บางบัวทอง', 13.91, 100.422, 0],
    ['B0301', 'ดุสิต', 'กรุงเทพฯ และปริมณฑล', 'ถ.สามเสน ดุสิต', 13.777, 100.512, 0],
    ['B0207', 'หลักสี่', 'กรุงเทพฯ และปริมณฑล', 'ถ.แจ้งวัฒนะ หลักสี่', 13.887, 100.579, 0],
    ['B0222', 'สะพานใหม่', 'กรุงเทพฯ และปริมณฑล', 'ถ.พหลโยธิน สายไหม', 13.879, 100.646, 0],
    ['B5101', 'นิมมานเหมินท์', 'ภาคเหนือ', 'ถ.นิมมานเหมินท์ เชียงใหม่', 18.7965, 98.9675, 0],
    ['B4001', 'ขอนแก่น มข.', 'ภาคตะวันออกเฉียงเหนือ', 'ถ.มิตรภาพ ขอนแก่น', 16.4746, 102.823, 0],
    ['B9001', 'หาดใหญ่', 'ภาคใต้', 'ถ.นิพัทธ์อุทิศ หาดใหญ่', 7.0084, 100.4747, 0],
    ['B2001', 'บางแสน', 'ภาคตะวันออก', 'ถ.ลงหาดบางแสน ชลบุรี', 13.2836, 100.9154, 0],
]

// [sku, ชื่อ, หมวด, หน่วย, กก./หน่วย, ราคา, สต็อกคลัง]
const PRODUCTS = [
    ['0004', 'สาหร่ายอบกรอบ', 'ขนม', 'ซอง', 0.05, 25, 150],
    ['0087', 'นมจืด UHT', 'เครื่องดื่ม', 'กล่อง', 0.25, 15, 2200],
    ['0091', 'นมเปรี้ยว', 'เครื่องดื่ม', 'ขวด', 0.2, 12, 1500],
    ['0112', 'น้ำดื่ม 600 มล.', 'เครื่องดื่ม', 'ขวด', 0.62, 7, 4800],
    ['0140', 'กาแฟกระป๋อง', 'เครื่องดื่ม', 'กระป๋อง', 0.2, 17, 300],
    ['0155', 'ชาเขียวขวด', 'เครื่องดื่ม', 'ขวด', 0.5, 20, 1800],
    ['0231', 'ขนมปังแซนด์วิช', 'อาหาร', 'ชิ้น', 0.12, 29, 600],
    ['0301', 'บะหมี่กึ่งสำเร็จรูป', 'อาหาร', 'ซอง', 0.06, 7, 2100],
    ['0412', 'ไข่ไก่ 10 ฟอง', 'อาหารสด', 'แผง', 0.6, 55, 400],
    ['0520', 'น้ำแข็งถุง', 'อื่น ๆ', 'ถุง', 2, 15, 900],
]

// สต็อกตั้งต้นของรามอินทรา (สาขาที่ใช้เดโม): [sku, qty, reorder_point, max]
const RAMINTRA = { '0004': [0, 10, 50], '0087': [9, 12, 60], '0091': [18, 6, 40], '0112': [58, 40, 200], '0140': [14, 15, 80], '0155': [40, 10, 60], '0231': [22, 10, 50], '0301': [64, 30, 150], '0412': [20, 8, 40], '0520': [30, 20, 120] }
// ระดับเริ่มต้นของสาขาอื่น (สัดส่วนของ max) กำหนดตายตัวให้ผลลัพธ์เหมือนเดิมทุกครั้ง
const DEFAULT_LIMITS = { '0004': [10, 50], '0087': [12, 60], '0091': [6, 40], '0112': [40, 200], '0140': [15, 80], '0155': [10, 60], '0231': [10, 50], '0301': [30, 150], '0412': [8, 40], '0520': [20, 120] }
const LEVELS = [0.9, 0.7, 0.55, 0.8, 0.45, 0.65, 0.75, 0.6, 0.5, 0.85]

const USERS = [
    ['admin@bl.test', 'นัส คลังกลาง', 'admin', null, '081-000-0001'],
    ['exec@bl.test', 'อา ผู้บริหาร', 'executive', null, '081-000-0002'],
    ['ramintra@bl.test', 'สุดา สาขารามอินทรา', 'branch', 'B0218', '081-000-0101'],
    ['latkrabang@bl.test', 'ปรีชา สาขาลาดกระบัง', 'branch', 'B0252', '081-000-0102'],
    ['minburi@bl.test', 'กมล สาขามีนบุรี', 'branch', 'B0231', '081-000-0103'],
    ['somchai@bl.test', 'สมชาย ใจดี', 'driver', null, '089-111-4521'],
    ['wichai@bl.test', 'วิชัย ทองดี', 'driver', null, '089-222-8812'],
    ['napa@bl.test', 'นภา ศรีสุข', 'driver', null, '089-333-1290'],
]

const VEHICLES = [
    ['1กข-4521', 'รถ 6 ล้อ', 3500],
    ['2ขค-8812', 'รถ 6 ล้อ', 3500],
    ['3กง-1290', 'รถ 4 ล้อ', 1500],
    ['4กจ-7710', 'รถ 4 ล้อ', 1500],
]

// ===== ชุดข้อมูลเล็ก: เรื่องเดียวจบ อ่านง่าย =====
// คลัง 1 แห่ง · สาขา 2 แห่ง · สินค้า 3 ตัว · คนขับ 1 คน · รถ 1 คัน
// - รามอินทรา: สาหร่ายหมด (0)        → ระบบร่างคำขอ "ด่วน" ให้
// - ลาดกระบัง: นมจืดเหลือ 8 (จุดสั่ง 12) → ระบบร่างคำขอ "ปกติ" ให้
const SMALL = process.argv.includes('--small')
if (SMALL) {
    const keepB = ['WH01', 'B0218', 'B0252']
    const keepP = ['0004', '0087', '0112']
    BRANCHES.splice(0, BRANCHES.length, ...BRANCHES.filter((b) => keepB.includes(b[0])))
    PRODUCTS.splice(0, PRODUCTS.length, ...PRODUCTS.filter((p) => keepP.includes(p[0])).map((p) => [...p.slice(0, 6), { '0004': 100, '0087': 500, '0112': 1000 }[p[0]]]))
    USERS.splice(0, USERS.length, ...USERS.filter((u) => ['admin@bl.test', 'exec@bl.test', 'ramintra@bl.test', 'latkrabang@bl.test', 'somchai@bl.test'].includes(u[0])))
    VEHICLES.splice(1)
}
// ===== เริ่มใหม่: คลังกลาง + 2 สาขา + บัญชี Admin, ผู้บริหาร, พนักงานสาขา 2, คนขับ 2 =====
// ไม่มีสินค้า รถ คำขอ หรือยอดขาย: Admin เพิ่มสินค้า (สต็อกคลังกลาง) และรถ (รถและคนขับ) เองจากหน้าเว็บ
const EMPTY = process.argv.includes('--empty')
const EMPTY_BRANCHES = [
    ['B0001', 'บางนา', 'กรุงเทพฯ และปริมณฑล', 'ถ.บางนา-ตราด แขวงบางนา เขตบางนา กรุงเทพฯ', 13.668300, 100.604700, 0],
    ['B0002', 'บางบอน', 'กรุงเทพฯ และปริมณฑล', 'ถ.เอกชัย แขวงบางบอน เขตบางบอน กรุงเทพฯ', 13.659400, 100.405500, 0],
]
// [อีเมล, ชื่อ, บทบาท, รหัสสาขา, เบอร์]
const EMPTY_USERS = [
    ['bangna@bl.test', 'พนักงาน สาขาบางนา', 'branch', 'B0001', '081-000-0201'],
    ['bangbon@bl.test', 'พนักงาน สาขาบางบอน', 'branch', 'B0002', '081-000-0202'],
    ['ris@bl.test', 'ริส', 'driver', null, '089-000-0301'],
    ['rif@bl.test', 'ริฟ', 'driver', null, '089-000-0302'],
]

// [qty, จุดสั่ง, สูงสุด] ของชุดเล็ก
const SMALL_STOCK = {
    B0218: { '0004': [0, 10, 50], '0087': [30, 12, 60], '0112': [150, 40, 200] },
    B0252: { '0004': [35, 10, 50], '0087': [8, 12, 60], '0112': [120, 40, 200] },
}

async function main() {
    const url = new URL(process.env.DATABASE_URL || 'mysql://root@localhost:3306/branch_logistics')
    const dbName = url.pathname.slice(1)
    url.pathname = '/'
    const admin = await mysql.createConnection({ uri: url.toString(), multipleStatements: true })
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await admin.query(`USE \`${dbName}\``)
    await admin.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))

    const c = admin
    if (EMPTY) {
        await c.query('INSERT INTO branch (code, name, region, address, lat, lng, is_warehouse) VALUES ?', [[BRANCHES[0], ...EMPTY_BRANCHES]])
        const [rows] = await c.query('SELECT id, code FROM branch')
        const bid = Object.fromEntries(rows.map((b) => [b.code, b.id]))
        const keep = [...USERS.filter((u) => ['admin', 'executive'].includes(u[2])), ...EMPTY_USERS]
        const hash = await bcrypt.hash(PASSWORD, 10)
        await c.query('INSERT INTO user (email, password, name, role, branch_id, phone) VALUES ?', [keep.map(([e, n, r, b, ph]) => [e, hash, n, r, b ? bid[b] : null, ph])])
        await c.end()
        console.log(`สร้างฐานข้อมูล ${dbName} ใหม่: คลังกลาง + สาขาบางนา, บางบอน ยังไม่มีสินค้า รถ คำขอ และยอดขาย`)
        console.log(`รหัสผ่าน: ${PASSWORD}`)
        console.log(keep.map(([e, n, r]) => `  ${r.padEnd(9)} ${e}  (${n})`).join('\n'))
        return
    }
    await c.query('INSERT INTO branch (code, name, region, address, lat, lng, is_warehouse) VALUES ?', [BRANCHES])
    await c.query('INSERT INTO product (sku, name, category, unit, weight_kg, price) VALUES ?', [PRODUCTS.map((p) => p.slice(0, 6))])
    const [branches] = await c.query('SELECT id, code FROM branch')
    const [products] = await c.query('SELECT id, sku FROM product')
    const bid = Object.fromEntries(branches.map((b) => [b.code, b.id]))
    const pid = Object.fromEntries(products.map((p) => [p.sku, p.id]))

    await c.query('INSERT INTO warehouse_stock (product_id, qty, reorder_point) VALUES ?', [PRODUCTS.map((p) => [pid[p[0]], p[6], Math.round(p[6] * 0.2)])])

    const stock = []
    branches.filter((b) => b.code !== 'WH01').forEach((b, bi) => {
        PRODUCTS.forEach(([sku], pi) => {
            if (SMALL) {
                stock.push([b.id, pid[sku], ...SMALL_STOCK[b.code][sku]])
            } else if (b.code === 'B0218') {
                const [qty, rp, max] = RAMINTRA[sku]
                stock.push([b.id, pid[sku], qty, rp, max])
            } else {
                const [rp, max] = DEFAULT_LIMITS[sku]
                stock.push([b.id, pid[sku], Math.round(max * LEVELS[(bi + pi) % LEVELS.length]), rp, max])
            }
        })
    })
    // ทำให้บางสาขามีของใกล้หมด/หมด เพื่อให้หน้า Admin มีคำขอหลายสาขา
    const tweak = [['B0252', '0004', 0], ['B0110', '0004', 6], ['B0231', '0004', 9], ['B0240', '0004', 8], ['B0231', '0087', 5], ['B0115', '0140', 3]]
    if (!SMALL) for (const [code, sku, qty] of tweak) stock.find((s) => s[0] === bid[code] && s[1] === pid[sku])[2] = qty
    await c.query('INSERT INTO branch_stock (branch_id, product_id, qty, reorder_point, max_qty) VALUES ?', [stock])
    // ค่ามาตรฐานของสินค้า (ใช้ตอนเปิดสาขาใหม่) = ค่าเฉลี่ยของสาขาที่มีอยู่
    await c.query(`UPDATE product p JOIN (SELECT product_id, ROUND(AVG(reorder_point)) AS rp, ROUND(AVG(max_qty)) AS mx FROM branch_stock GROUP BY product_id) a ON a.product_id = p.id
             SET p.branch_reorder_point = a.rp, p.branch_max_qty = GREATEST(a.mx, a.rp + 1)`)

    const hash = await bcrypt.hash(PASSWORD, 10)
    await c.query('INSERT INTO user (email, password, name, role, branch_id, phone) VALUES ?', [USERS.map(([e, n, r, b, ph]) => [e, hash, n, r, b ? bid[b] : null, ph])])
    await c.query('INSERT INTO vehicle (plate, type, capacity_kg) VALUES ?', [VEHICLES])
    // รถประจำ: คนขับคนที่ 1 → รถคันที่ 1, คนที่ 2 → คันที่ 2 ...
    const drivers = USERS.filter((u) => u[2] === 'driver')
    for (const [i, [email]] of drivers.entries()) {
        if (VEHICLES[i]) await c.query('UPDATE user SET default_vehicle_id = (SELECT id FROM vehicle WHERE plate = ?) WHERE email = ?', [VEHICLES[i][0], email])
    }

    // ยอดขายย้อนหลัง 30 วันให้กราฟใน Dashboard (เป็นประวัติอย่างเดียว ไม่แตะสต็อกที่ตั้งไว้ข้างบน)
    await c.query("SET time_zone = '+00:00'")
    const sales = await seedSales(c, 30)

    await c.end()
    console.log(`ยอดขายย้อนหลัง 30 วัน: ${sales.bills.toLocaleString()} บิล`)
    console.log(`สร้างฐานข้อมูล ${dbName} แล้ว${SMALL ? ' (ชุดเล็ก)' : ''}: ${BRANCHES.length - 1} สาขา, ${PRODUCTS.length} สินค้า, ${USERS.length} ผู้ใช้`)
    console.log(`รหัสผ่านทุกบัญชี: ${PASSWORD}`)
    console.log(USERS.map(([e, n, r]) => `  ${r.padEnd(9)} ${e}  (${n})`).join('\n'))
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
