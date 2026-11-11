// ทดสอบ flow เต็มผ่าน API จริง: ขาย → ร่างคำขอ → ยืนยัน → อนุมัติ → จัดเที่ยว → ส่ง → รับของ
// ใช้งาน: npm run db:reset && npm run test:flow   (ใช้ฐานข้อมูลใน .env  ⚠️ ข้อมูลจะเปลี่ยน)
try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')) } catch {}
process.env.NODE_ENV = 'test'
const assert = require('assert/strict')
const { server } = require('../server')
const { pool, one } = require('../config/db')
const { scanAllBranches } = require('../services/replenish')

const PASS = process.env.DEMO_PASSWORD || 'Demo@1234'
let base

// client เล็ก ๆ ที่จำ cookie แยกตามผู้ใช้
const client = () => {
    let cookie = ''
    const call = async (method, path, body, headers = {}) => {
        const res = await fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
            body: body ? JSON.stringify(body) : undefined,
        })
        const set = res.headers.get('set-cookie')
        if (set) cookie = set.split(';')[0]
        const data = await res.json().catch(() => null)
        return { status: res.status, data }
    }
    return { call, login: (email) => call('POST', '/api/auth/login', { email, password: PASS }) }
}

const step = (msg) => console.log(`✔ ${msg}`)

async function main() {
    await new Promise((r) => server.listen(0, r))
    base = `http://127.0.0.1:${server.address().port}`
    const ids = Object.fromEntries((await pool.query('SELECT sku, id FROM product'))[0].map((p) => [p.sku, p.id]))
    const ram = await one("SELECT id FROM branch WHERE code = 'B0218'")
    const lat = await one("SELECT id FROM branch WHERE code = 'B0252'")

    const branch = client(), admin = client(), driver = client(), other = client(), exec = client()
    assert.equal((await branch.login('ramintra@bl.test')).status, 200)
    assert.equal((await admin.login('admin@bl.test')).status, 200)
    assert.equal((await driver.login('somchai@bl.test')).status, 200)
    assert.equal((await other.login('latkrabang@bl.test')).status, 200)
    assert.equal((await exec.login('exec@bl.test')).status, 200)
    assert.equal((await branch.call('POST', '/api/auth/login', { email: 'ramintra@bl.test', password: 'wrong' })).status, 401)
    step('ล็อกอิน 5 บทบาท และรหัสผิดถูกปฏิเสธ')

    // สิทธิ์: สาขาอื่นดูสต็อกรามอินทราไม่ได้, คนขับดูคำขอไม่ได้, สาขาอนุมัติไม่ได้
    assert.equal((await other.call('GET', `/api/branches/${ram.id}/stock`)).status, 403)
    assert.equal((await driver.call('GET', '/api/requests')).status, 403)
    assert.equal((await branch.call('GET', '/api/warehouse/stock')).status, 403)
    assert.equal((await client().call('GET', '/api/requests')).status, 401)
    step('แยกสิทธิ์ตามบทบาทและสาขาที่ฝั่ง server')

    // POS ขายกาแฟ 2 กระป๋อง (เหลือ 14 → 12 ต่ำกว่าจุดสั่ง 15) → ระบบร่างคำขอ
    const bill = { bill_id: 'B0218-0001', items: [{ product_id: ids['0140'], qty: 2 }] }
    const s1 = await branch.call('POST', `/api/branches/${ram.id}/sales`, bill, { 'X-POS-Key': process.env.POS_API_KEY })
    assert.equal(s1.status, 201)
    assert.ok(s1.data.draft, 'ควรร่างคำขอ')
    assert.equal(s1.data.draft.added[0].qty, 80 - 12)
    const dup = await branch.call('POST', `/api/branches/${ram.id}/sales`, bill)
    assert.equal(dup.data.duplicate, true)
    const coffee = await one('SELECT qty FROM branch_stock WHERE branch_id = ? AND product_id = ?', [ram.id, ids['0140']])
    assert.equal(coffee.qty, 12, 'บิลซ้ำต้องไม่ตัดสต็อกซ้ำ')
    step('POS ตัดสต็อก, ร่างคำขอให้อัตโนมัติ (แนะนำ 68 = 80−12), บิลซ้ำไม่ตัดซ้ำ')

    // ขายต่อ: ร่างเดิมยังเปิดอยู่ ต้องไม่สร้างคำขอใหม่
    const s2 = await branch.call('POST', `/api/branches/${ram.id}/sales`, { bill_id: 'B0218-0002', items: [{ product_id: ids['0140'], qty: 1 }] })
    assert.equal(s2.data.draft, null)
    step('ไม่สร้างคำขอซ้ำเมื่อสินค้ามีคำขอเปิดอยู่แล้ว')

    // สแกนสำรอง: เพิ่มสาหร่าย (หมด) และนมจืดเข้าร่างเดิม + ยกเป็นด่วน
    await scanAllBranches()
    const dash = await branch.call('GET', `/api/dashboard/branch/${ram.id}`)
    const draftId = dash.data.draft.id
    const draft = await branch.call('GET', `/api/requests/${draftId}`)
    assert.equal(draft.data.priority, 'urgent')
    assert.deepEqual(draft.data.items.map((i) => i.sku), ['0004', '0087', '0140'])
    assert.equal(draft.data.items[0].warehouseAvailable, undefined, 'สาขาไม่ควรเห็นยอดคลัง')
    step(`สแกนสำรองรวมของหมดเข้าร่าง ${draft.data.code} และยกเป็นด่วน`)

    // สาขาแก้จำนวนแล้วยืนยันส่ง
    assert.equal((await branch.call('PATCH', `/api/requests/${draftId}`, { items: [{ product_id: ids['0140'], qty: 66 }] })).status, 200)
    assert.equal((await other.call('POST', `/api/requests/${draftId}/submit`)).status, 403)
    assert.equal((await branch.call('POST', `/api/requests/${draftId}/submit`)).status, 200)
    step('สาขาแก้จำนวนและยืนยันคำขอ (สาขาอื่นยืนยันแทนไม่ได้)')

    // Admin อนุมัติเกินคลัง → 409 พร้อมรายละเอียด แล้วอนุมัติแบบลดจำนวน
    const over = await admin.call('POST', `/api/requests/${draftId}/approve`, { items: [{ product_id: ids['0004'], qty_approved: 999 }] })
    assert.equal(over.status, 409)
    assert.equal(over.data.details[0].available, 150)
    const ok = await admin.call('POST', `/api/requests/${draftId}/approve`, { items: [{ product_id: ids['0004'], qty_approved: 40 }] })
    assert.equal(ok.status, 200)
    const ws = await one('SELECT qty, reserved_qty FROM warehouse_stock WHERE product_id = ?', [ids['0004']])
    assert.deepEqual([ws.qty, ws.reserved_qty], [150, 40])
    step('อนุมัติเกินคลังถูกปฏิเสธ, อนุมัติสาหร่าย 40 และจองสต็อกคลัง')

    // ข้อเสนอจัดสรร: ลาดกระบังก็ขอสาหร่าย (ถ้ามีคำขอรออนุมัติ)
    const latDraft = (await other.call('GET', `/api/dashboard/branch/${lat.id}`)).data.draft
    if (latDraft) await other.call('POST', `/api/requests/${latDraft.id}/submit`)
    const alloc = await admin.call('GET', `/api/warehouse/allocation/${ids['0004']}`)
    assert.equal(alloc.status, 200)
    assert.equal(alloc.data.available, 110)
    step(`ข้อเสนอจัดสรรสาหร่าย: เหลือในคลัง ${alloc.data.available}, ${alloc.data.plan.length} คำขอรออยู่`)

    // จัดเที่ยว: น้ำหนักเกินรถ 4 ล้อ? (ทดสอบว่าเช็กความจุ) แล้วจัดด้วยรถ 6 ล้อ
    const vehicles = (await admin.call('GET', '/api/vehicles')).data
    const somchai = (await admin.call('GET', '/api/drivers')).data.find((d) => d.name === 'สมชาย ใจดี')
    const trip = await admin.call('POST', '/api/trips', { driver_id: somchai.id, vehicle_id: vehicles[0].id, request_ids: [draftId] })
    assert.equal(trip.status, 201)
    assert.equal((await admin.call('POST', '/api/trips', { driver_id: somchai.id, vehicle_id: vehicles[1].id, request_ids: [draftId] })).status, 409)
    const tripId = trip.data.id
    step(`สร้างเที่ยว ${trip.data.code} (${trip.data.totalKg} กก. / ${trip.data.capacityKg} กก.) และคำขอเดียวกันอยู่สองเที่ยวไม่ได้`)

    // คนขับ: ต้องรับงานก่อนออก, ออกเดินทาง = ของออกจากคลัง
    assert.equal((await driver.call('POST', `/api/trips/${tripId}/start`)).status, 409)
    assert.equal((await driver.call('POST', `/api/trips/${tripId}/accept`)).status, 200)
    assert.equal((await driver.call('POST', `/api/trips/${tripId}/start`)).status, 200)
    const ws2 = await one('SELECT qty, reserved_qty FROM warehouse_stock WHERE product_id = ?', [ids['0004']])
    assert.deepEqual([ws2.qty, ws2.reserved_qty], [110, 0])
    assert.equal((await driver.call('POST', `/api/trips/${tripId}/location`, { lat: 13.89, lng: 100.58, speed: 32 })).status, 201)
    assert.equal((await driver.call('POST', `/api/trips/${tripId}/location`, { lat: 200, lng: 0 })).status, 400)
    const seen = await branch.call('GET', `/api/trips/${tripId}`)
    assert.equal(seen.data.lastLocation.lat, 13.89)
    assert.equal((await other.call('GET', `/api/trips/${tripId}`)).status, 403)
    step('รับงาน → ออกเดินทาง (คลังลด 40 และปลดยอดจอง) → ส่งพิกัด, สาขาปลายทางเห็นรถ สาขาอื่นไม่เห็น')

    // รับของก่อนรถถึงไม่ได้ → คนขับกดถึง → สาขารับ (นมขาด 6, กาแฟเสีย 2)
    const items = (await branch.call('GET', `/api/requests/${draftId}`)).data.items
    const receiveBody = { items: items.map((i) => ({ product_id: i.productId, qty_received: i.sku === '0087' ? i.qtyApproved - 6 : i.sku === '0140' ? i.qtyApproved - 2 : i.qtyApproved, qty_damaged: i.sku === '0140' ? 2 : 0 })) }
    assert.equal((await branch.call('POST', `/api/requests/${draftId}/receive`, receiveBody)).status, 409)
    const stopId = seen.data.stops[0].id
    assert.equal((await driver.call('POST', `/api/trips/${tripId}/stops/${stopId}/arrive`)).status, 200)
    const before = await one('SELECT qty FROM branch_stock WHERE branch_id = ? AND product_id = ?', [ram.id, ids['0004']])
    const rec = await branch.call('POST', `/api/requests/${draftId}/receive`, receiveBody)
    assert.equal(rec.status, 200)
    assert.equal(rec.data.tripCompleted, true)
    assert.equal(rec.data.issues.length, 2)
    const after = await one('SELECT qty FROM branch_stock WHERE branch_id = ? AND product_id = ?', [ram.id, ids['0004']])
    assert.equal(after.qty - before.qty, 40)
    const v = await one('SELECT status FROM vehicle WHERE id = ?', [vehicles[0].id])
    assert.equal(v.status, 'available')
    step('รับของได้หลังรถถึงเท่านั้น, สต็อกสาขาเพิ่ม, บันทึกของขาด/เสีย, เที่ยวปิดและรถว่าง')

    // แจ้งเตือน + dashboard
    const an = await admin.call('GET', '/api/notifications')
    assert.ok(an.data.items.some((n) => n.type === 'receive_issue'))
    const bn = await other.call('GET', '/api/notifications')
    assert.ok(!bn.data.items.some((n) => n.message.includes('รามอินทรา') && n.type === 'trip_started'))
    const ov = await exec.call('GET', '/api/dashboard/overview')
    assert.equal(ov.status, 200)
    step(`แจ้งเตือนถึงคนที่เกี่ยวข้องเท่านั้น, Dashboard ผู้บริหาร: ${ov.data.kpi.trips} เที่ยว, ${ov.data.kpi.branchesOut} สาขามีของหมด`)

    // นับสต็อก + ของเสีย
    const cnt = await branch.call('POST', `/api/branches/${ram.id}/stock-count`, { items: [{ product_id: ids['0155'], counted: 42 }] })
    assert.equal(cnt.data.items[0].diff, 2)
    assert.equal((await branch.call('POST', `/api/branches/${ram.id}/waste`, { product_id: ids['0231'], qty: 4, reason: 'expired' })).status, 201)
    step('นับสต็อกปรับยอด (+2) และบันทึกของเสีย')

    console.log('\nผ่านทุกขั้นตอน ✅')
}

main()
    .catch((err) => {
        console.error('\n❌', err.message)
        process.exitCode = 1
    })
    .finally(async () => {
        server.close()
        await pool.end()
    })
