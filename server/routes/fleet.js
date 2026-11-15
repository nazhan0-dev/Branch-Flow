const router = require('express').Router()
const bcrypt = require('bcryptjs')
const { query, one, transaction } = require('../config/db')
const { fail, handle, posInt } = require('../config/errors')
const { text, password, email: emailOf, phone: phoneOf } = require('../config/validate')
const { authCheck, requireRole } = require('../middlewares/auth')
const { emit } = require('../services/realtime')

// รถและคนขับ: Admin เท่านั้น (ผู้บริหารดูภาพรวมจากหน้า Dashboard)
const ACTIVE = ['assigned', 'accepted', 'on_route']
const STATUS = ['available', 'maintenance', 'retired']

// เที่ยวที่ยังไม่จบของรถ/คนขับ (ใช้กันส่งซ่อม เลิกใช้ หรือปิดบัญชีระหว่างมีงาน)
const activeTrip = (col, id, conn) =>
    one(`SELECT id, code, status FROM trip WHERE ${col} = ? AND status IN (?) ORDER BY id DESC LIMIT 1`, [id, ACTIVE], conn)
const changed = () => emit('ops', 'fleet_changed', {})

// ---------- รถ ----------

router.get('/fleet/vehicles', authCheck, requireRole('admin'), handle(async (req, res) => {
    res.json(await query(
        `SELECT v.id, v.plate, v.type, v.capacity_kg AS capacityKg, v.status,
                (SELECT JSON_OBJECT('id', t.id, 'code', t.code, 'status', t.status, 'driver', u.name)
                   FROM trip t JOIN user u ON u.id = t.driver_id WHERE t.vehicle_id = v.id AND t.status IN (?) ORDER BY t.id DESC LIMIT 1) AS trip,
                (SELECT GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR ', ') FROM user u WHERE u.default_vehicle_id = v.id AND u.enabled = 1) AS regularDrivers,
                (SELECT COUNT(*) FROM trip t WHERE t.vehicle_id = v.id AND t.created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY) AS trips30d
         FROM vehicle v ORDER BY v.status = 'retired', v.capacity_kg DESC, v.plate`,
        [ACTIVE]
    ).then((rows) => rows.map((r) => ({ ...r, trip: typeof r.trip === 'string' ? JSON.parse(r.trip) : r.trip }))))
}))

router.post('/fleet/vehicles', authCheck, requireRole('admin'), handle(async (req, res) => {
    const plate = text(req.body?.plate, 'ทะเบียนรถ', 20)
    const type = text(req.body?.type, 'ประเภทรถ', 30)
    const capacityKg = posInt(req.body?.capacity_kg, 'น้ำหนักบรรทุก')
    if (capacityKg < 100 || capacityKg > 40000) fail(400, 'น้ำหนักบรรทุกต้องอยู่ระหว่าง 100–40,000 กก.')
    if (await one('SELECT id FROM vehicle WHERE plate = ?', [plate])) fail(409, `ทะเบียน ${plate} มีอยู่แล้ว`)
    const ins = await query('INSERT INTO vehicle (plate, type, capacity_kg) VALUES (?, ?, ?)', [plate, type, capacityKg])
    changed()
    res.status(201).json({ id: ins.insertId, plate })
}))

// เปลี่ยนสถานะ: พร้อมใช้ / ส่งซ่อม / เลิกใช้ (ไม่ลบ เพราะเที่ยวเก่ายังอ้างถึงรถคันนี้)
router.patch('/fleet/vehicles/:id', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    const status = req.body?.status
    if (!STATUS.includes(status)) fail(400, `status ต้องเป็น ${STATUS.join(' / ')}`)
    await transaction(async (conn) => {
        const v = await one('SELECT id, plate, status FROM vehicle WHERE id = ? FOR UPDATE', [id], conn)
        if (!v) fail(404, 'ไม่พบรถ')
        const t = await activeTrip('vehicle_id', id, conn)
        if (t) fail(409, `รถ ${v.plate} มีงาน ${t.code} อยู่ เปลี่ยนสถานะได้หลังส่งเสร็จ`)
        await query('UPDATE vehicle SET status = ? WHERE id = ?', [status, id], conn)
        // รถเลิกใช้แล้วไม่ควรเป็นรถประจำของใคร
        if (status === 'retired') await query('UPDATE user SET default_vehicle_id = NULL WHERE default_vehicle_id = ?', [id], conn)
    })
    changed()
    res.json({ ok: true })
}))

// ---------- คนขับ ----------

router.get('/fleet/drivers', authCheck, requireRole('admin'), handle(async (req, res) => {
    res.json(await query(
        `SELECT u.id, u.name, u.email, u.phone, u.enabled, u.default_vehicle_id AS defaultVehicleId, v.plate AS defaultPlate,
                (SELECT JSON_OBJECT('id', t.id, 'code', t.code, 'status', t.status) FROM trip t WHERE t.driver_id = u.id AND t.status IN (?) ORDER BY t.id DESC LIMIT 1) AS trip,
                (SELECT COUNT(*) FROM trip t WHERE t.driver_id = u.id AND t.created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY) AS trips30d
         FROM user u LEFT JOIN vehicle v ON v.id = u.default_vehicle_id
         WHERE u.role = 'driver' ORDER BY u.enabled DESC, u.name`,
        [ACTIVE]
    ).then((rows) => rows.map((r) => ({ ...r, enabled: Boolean(r.enabled), trip: typeof r.trip === 'string' ? JSON.parse(r.trip) : r.trip }))))
}))

const checkDefaultVehicle = async (vid, conn) => {
    if (vid === null || vid === undefined || vid === '') return null
    const id = posInt(vid, 'รถประจำ')
    const v = await one('SELECT id, status FROM vehicle WHERE id = ?', [id], conn)
    if (!v) fail(400, 'ไม่พบรถประจำที่เลือก')
    if (v.status === 'retired') fail(400, 'รถคันนี้เลิกใช้แล้ว')
    return id
}

router.post('/fleet/drivers', authCheck, requireRole('admin'), handle(async (req, res) => {
    const name = text(req.body?.name, 'ชื่อ', 100, { min: 2 })
    const email = emailOf(req.body?.email)
    const phone = phoneOf(req.body?.phone)
    const pw = password(req.body?.password)
    const vid = await checkDefaultVehicle(req.body?.default_vehicle_id)
    if (await one('SELECT id FROM user WHERE email = ?', [email])) fail(409, `อีเมล ${email} มีบัญชีอยู่แล้ว`)
    // เก็บเฉพาะค่า hash ของรหัสผ่าน (bcrypt) ไม่เก็บรหัสจริง
    const hash = await bcrypt.hash(pw, 10)
    const ins = await query(
        "INSERT INTO user (email, password, name, role, phone, default_vehicle_id) VALUES (?, ?, ?, 'driver', ?, ?)",
        [email, hash, name, phone || null, vid]
    )
    changed()
    res.status(201).json({ id: ins.insertId, email })
}))

// แก้รถประจำ / ปิด-เปิดบัญชี (ปิดบัญชีแทนการลบ ประวัติเที่ยวเก่ายังอยู่ ล็อกอินไม่ได้ทันที)
router.patch('/fleet/drivers/:id', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    await transaction(async (conn) => {
        const u = await one("SELECT id, name, enabled FROM user WHERE id = ? AND role = 'driver' FOR UPDATE", [id], conn)
        if (!u) fail(404, 'ไม่พบคนขับ')
        if ('default_vehicle_id' in (req.body || {})) {
            const vid = await checkDefaultVehicle(req.body.default_vehicle_id, conn)
            await query('UPDATE user SET default_vehicle_id = ? WHERE id = ?', [vid, id], conn)
        }
        if ('enabled' in (req.body || {})) {
            const enabled = req.body.enabled === true
            if (!enabled) {
                const t = await activeTrip('driver_id', id, conn)
                if (t) fail(409, `${u.name} มีงาน ${t.code} อยู่ ปิดบัญชีได้หลังส่งเสร็จ หรือมอบงานให้คนอื่นก่อน`)
            }
            await query('UPDATE user SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id], conn)
        }
    })
    changed()
    res.json({ ok: true })
}))

// ตั้งรหัสผ่านใหม่ให้คนขับที่ลืมรหัส (เครื่องที่ล็อกอินด้วยรหัสเก่าถูกออกจากระบบ)
router.post('/fleet/drivers/:id/password', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    const pw = password(req.body?.password)
    const u = await one("SELECT id FROM user WHERE id = ? AND role = 'driver'", [id])
    if (!u) fail(404, 'ไม่พบคนขับ')
    await query('UPDATE user SET password = ?, password_changed = UNIX_TIMESTAMP() WHERE id = ?', [await bcrypt.hash(pw, 10), id])
    res.json({ ok: true })
}))

module.exports = router
