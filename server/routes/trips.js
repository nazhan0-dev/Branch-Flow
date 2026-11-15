const router = require('express').Router()
const { query, one, transaction } = require('../config/db')
const { fail, handle, posInt } = require('../config/errors')
const { authCheck, requireRole } = require('../middlewares/auth')
const { notify } = require('../services/notify')
const { emit } = require('../services/realtime')
const { tripCode } = require('../services/codes')
const { estimateEtas } = require('../services/geo')

const ACTIVE = ['assigned', 'accepted', 'on_route']

const warehouse = () => one('SELECT id, name, lat, lng FROM branch WHERE is_warehouse = 1 LIMIT 1')

// ใครดูเที่ยวนี้ได้: admin/ผู้บริหาร ทั้งหมด, คนขับเฉพาะของตัวเอง, สาขาเฉพาะเที่ยวที่มีจุดส่งของสาขาตัวเอง
const loadTrip = async (id, user, conn, lock = false) => {
    const t = await one(`SELECT * FROM trip WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id], conn)
    if (!t) fail(404, 'ไม่พบเที่ยวส่ง')
    if (user.role === 'driver' && t.driver_id !== user.id) fail(403, 'ไม่ใช่งานของคุณ')
    if (user.role === 'branch') {
        const mine = await one('SELECT ts.id FROM trip_stop ts JOIN replenish_request r ON r.id = ts.request_id WHERE ts.trip_id = ? AND r.branch_id = ?', [id, user.branchId], conn)
        if (!mine) fail(403, 'เที่ยวนี้ไม่ได้มาสาขาของคุณ')
    }
    return t
}

const branchRoomsOfTrip = async (tripId, conn) =>
    (await query(
        "SELECT DISTINCT r.branch_id FROM trip_stop ts JOIN replenish_request r ON r.id = ts.request_id WHERE ts.trip_id = ? AND ts.status <> 'received'",
        [tripId],
        conn
    )).map((b) => `branch:${b.branch_id}`)

router.get('/vehicles', authCheck, requireRole('admin', 'executive'), handle(async (req, res) => {
    // busy = มีเที่ยวที่ยังไม่จบ (มอบงานแล้วแต่ยังไม่ออก ก็นับว่าไม่ว่าง กันจัดรถคันเดียวซ้ำสองเที่ยว)
    res.json(await query(
        `SELECT v.id, v.plate, v.type, v.capacity_kg AS capacityKg, v.status,
                EXISTS (SELECT 1 FROM trip t WHERE t.vehicle_id = v.id AND t.status IN (?)) AS busy
         FROM vehicle v WHERE v.status <> 'retired' ORDER BY v.capacity_kg DESC`,
        [ACTIVE]
    ))
}))

router.get('/drivers', authCheck, requireRole('admin', 'executive'), handle(async (req, res) => {
    res.json(await query(
        `SELECT u.id, u.name, u.phone, u.default_vehicle_id AS defaultVehicleId,
                SUM(t.status = 'on_route') AS onRoute, SUM(t.status IN ('assigned','accepted')) AS queued
         FROM user u LEFT JOIN trip t ON t.driver_id = u.id AND t.status IN (?)
         WHERE u.role = 'driver' AND u.enabled = 1 GROUP BY u.id ORDER BY onRoute, queued, u.name`,
        [ACTIVE]
    ))
}))

/**
 * Admin สร้างเที่ยวส่ง: รวมคำขอที่อนุมัติแล้วหลายสาขาเป็นเที่ยวเดียว เรียงจุดตามลำดับที่ส่งมา
 * ตรวจน้ำหนักไม่เกินความจุรถ และคำขอหนึ่งอยู่ได้แค่เที่ยวเดียว
 */
router.post('/trips', authCheck, requireRole('admin'), handle(async (req, res) => {
    const driverId = posInt(req.body?.driver_id, 'driver_id')
    const vehicleId = posInt(req.body?.vehicle_id, 'vehicle_id')
    const ids = req.body?.request_ids
    if (!Array.isArray(ids) || !ids.length) fail(400, 'เลือกคำขออย่างน้อย 1 รายการ')
    const requestIds = ids.map((i) => posInt(i, 'request_ids'))
    if (new Set(requestIds).size !== requestIds.length) fail(400, 'มีคำขอซ้ำ')

    const created = await transaction(async (conn) => {
        const driver = await one("SELECT id, name FROM user WHERE id = ? AND role = 'driver' AND enabled = 1", [driverId], conn)
        if (!driver) fail(400, 'ไม่พบคนขับ')
        const vehicle = await one('SELECT * FROM vehicle WHERE id = ? FOR UPDATE', [vehicleId], conn)
        if (!vehicle || ['maintenance', 'retired'].includes(vehicle.status)) fail(400, 'รถคันนี้ใช้งานไม่ได้ (ส่งซ่อมหรือเลิกใช้)')
        const busy = await one('SELECT code FROM trip WHERE vehicle_id = ? AND status IN (?) LIMIT 1', [vehicleId, ACTIVE], conn)
        if (busy) fail(409, `รถ ${vehicle.plate} ติดงาน ${busy.code} อยู่`)

        const reqs = await query(
            `SELECT r.id, r.code, r.status, r.branch_id, ts.id AS stopId,
                    (SELECT SUM(ri.qty_approved * p.weight_kg) FROM request_item ri JOIN product p ON p.id = ri.product_id WHERE ri.request_id = r.id) AS kg
             FROM replenish_request r LEFT JOIN trip_stop ts ON ts.request_id = r.id
             WHERE r.id IN (?) FOR UPDATE`,
            [requestIds],
            conn
        )
        if (reqs.length !== requestIds.length) fail(400, 'มีคำขอที่ไม่พบ')
        const bad = reqs.filter((r) => r.status !== 'approved' || r.stopId)
        if (bad.length) fail(409, `คำขอต่อไปนี้ยังไม่อนุมัติหรืออยู่ในเที่ยวอื่นแล้ว: ${bad.map((b) => b.code).join(', ')}`)
        const totalKg = reqs.reduce((s, r) => s + Number(r.kg || 0), 0)
        if (totalKg > vehicle.capacity_kg) fail(409, `น้ำหนักรวม ${Math.round(totalKg)} กก. เกินความจุรถ ${vehicle.capacity_kg} กก.`)

        const ins = await query('INSERT INTO trip (code, driver_id, vehicle_id, created_by) VALUES (?, ?, ?, ?)', ['tmp', driverId, vehicleId, req.user.id], conn)
        const code = tripCode(ins.insertId)
        await query('UPDATE trip SET code = ? WHERE id = ?', [code, ins.insertId], conn)
        await query('INSERT INTO trip_stop (trip_id, request_id, seq) VALUES ?', [requestIds.map((rid, i) => [ins.insertId, rid, i + 1])], conn)

        await notify({ userId: driverId, role: 'driver' }, 'trip_assigned', `งานใหม่ ${code}: ${requestIds.length} จุดส่ง`, `/driver/trips/${ins.insertId}`, conn)
        for (const r of reqs) await notify({ role: 'branch', branchId: r.branch_id }, 'trip_assigned', `${r.code} ถูกจัดเข้าเที่ยวส่ง ${code}`, `/branch/requests/${r.id}`, conn)
        return { id: ins.insertId, code, totalKg: Math.round(totalKg), capacityKg: vehicle.capacity_kg, driverId }
    })
    emit(['ops', `driver:${created.driverId}`], 'trip_changed', { tripId: created.id })
    res.status(201).json(created)
}))

router.get('/trips', authCheck, handle(async (req, res) => {
    const where = []
    const params = []
    if (req.user.role === 'driver') {
        where.push('t.driver_id = ?')
        params.push(req.user.id)
    } else if (req.user.role === 'branch') {
        where.push('EXISTS (SELECT 1 FROM trip_stop s2 JOIN replenish_request r2 ON r2.id = s2.request_id WHERE s2.trip_id = t.id AND r2.branch_id = ?)')
        params.push(req.user.branchId)
    }
    if (req.query.active === '1') where.push("t.status IN ('assigned','accepted','on_route')")
    res.json(await query(
        `SELECT t.id, t.code, t.status, t.created_at AS createdAt, t.started_at AS startedAt, t.finished_at AS finishedAt,
                u.name AS driverName, v.plate, v.type AS vehicleType,
                COUNT(ts.id) AS stopCount, SUM(ts.status = 'received') AS receivedCount, SUM(ts.status <> 'pending') AS arrivedCount,
                GROUP_CONCAT(b.name ORDER BY ts.seq SEPARATOR '|') AS stopNames,
                MIN(CASE WHEN ts.status = 'pending' THEN ts.eta END) AS nextEta,
                (SELECT JSON_OBJECT('lat', lp.lat, 'lng', lp.lng, 'at', lp.recorded_at) FROM location_ping lp WHERE lp.trip_id = t.id ORDER BY lp.id DESC LIMIT 1) AS lastLocation
         FROM trip t JOIN user u ON u.id = t.driver_id JOIN vehicle v ON v.id = t.vehicle_id
         LEFT JOIN trip_stop ts ON ts.trip_id = t.id
         LEFT JOIN replenish_request rq ON rq.id = ts.request_id
         LEFT JOIN branch b ON b.id = rq.branch_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         GROUP BY t.id ORDER BY FIELD(t.status, 'on_route', 'accepted', 'assigned', 'completed', 'cancelled'), t.id DESC LIMIT 100`,
        params
    ).then((rows) => rows.map((r) => ({ ...r, stopNames: r.stopNames ? r.stopNames.split('|') : [], lastLocation: typeof r.lastLocation === 'string' ? JSON.parse(r.lastLocation) : r.lastLocation }))))
}))

router.get('/trips/:id', authCheck, handle(async (req, res) => {
    const t = await loadTrip(Number(req.params.id), req.user)
    const driver = await one('SELECT id, name, phone FROM user WHERE id = ?', [t.driver_id])
    const vehicle = await one('SELECT id, plate, type, capacity_kg AS capacityKg FROM vehicle WHERE id = ?', [t.vehicle_id])
    let stops = await query(
        `SELECT ts.id, ts.seq, ts.status, ts.eta, ts.arrived_at AS arrivedAt, ts.received_at AS receivedAt,
                r.id AS requestId, r.code AS requestCode, r.priority, b.id AS branchId, b.name AS branchName, b.address, b.lat, b.lng
         FROM trip_stop ts JOIN replenish_request r ON r.id = ts.request_id JOIN branch b ON b.id = r.branch_id
         WHERE ts.trip_id = ? ORDER BY ts.seq`,
        [t.id]
    )
    const items = await query(
        `SELECT ri.request_id, p.sku, p.name, ri.qty_approved AS qty FROM request_item ri JOIN product p ON p.id = ri.product_id
         WHERE ri.request_id IN (?) AND ri.qty_approved > 0 ORDER BY p.sku`,
        [stops.map((s) => s.requestId).concat(0)]
    )
    stops = stops.map((s) => ({ ...s, items: items.filter((i) => i.request_id === s.requestId).map(({ request_id, ...i }) => i) }))
    const total = stops.length
    const progress = stops.map((s) => ({ seq: s.seq, status: s.status, eta: s.eta, arrivedAt: s.arrivedAt, receivedAt: s.receivedAt }))
    // สาขาเห็นเฉพาะจุดส่งของตัวเอง แต่รู้ความคืบหน้าของจุดอื่น (ไม่เห็นชื่อสาขาอื่น)
    if (req.user.role === 'branch') stops = stops.filter((s) => s.branchId === req.user.branchId)
    const last = await one('SELECT lat, lng, speed, recorded_at AS at FROM location_ping WHERE trip_id = ? ORDER BY id DESC LIMIT 1', [t.id])
    res.json({
        id: t.id, code: t.code, status: t.status, createdAt: t.created_at, startedAt: t.started_at, finishedAt: t.finished_at,
        driver, vehicle, origin: await warehouse(), stopCount: total, stops, progress, lastLocation: last,
    })
}))

/**
 * Admin ยกเลิกเที่ยวที่ยังไม่ออกจากคลัง (จัดผิดคน/ผิดรถ)
 * คำขอทุกจุดกลับไปเป็น "อนุมัติแล้ว · รอจัดรถ" (ยอดจองในคลังยังอยู่) จัดเที่ยวใหม่ได้ทันที
 * เที่ยวที่ออกเดินทางแล้วยกเลิกไม่ได้ เพราะของออกจากคลังไปแล้ว
 */
router.post('/trips/:id/cancel', authCheck, requireRole('admin'), handle(async (req, res) => {
    const reason = String(req.body?.reason || '').trim().slice(0, 200)
    if (!reason) fail(400, 'ระบุเหตุผลที่ยกเลิก')
    const out = await transaction(async (conn) => {
        const t = await loadTrip(Number(req.params.id), req.user, conn, true)
        if (!['assigned', 'accepted'].includes(t.status)) fail(409, t.status === 'on_route' ? 'รถออกจากคลังแล้ว ยกเลิกเที่ยวไม่ได้' : 'เที่ยวนี้ปิดไปแล้ว')
        const stops = await query('SELECT ts.request_id, r.code, r.branch_id FROM trip_stop ts JOIN replenish_request r ON r.id = ts.request_id WHERE ts.trip_id = ?', [t.id], conn)
        await query('DELETE FROM trip_stop WHERE trip_id = ?', [t.id], conn)
        await query("UPDATE trip SET status = 'cancelled', finished_at = UTC_TIMESTAMP(3) WHERE id = ?", [t.id], conn)
        await notify({ userId: t.driver_id, role: 'driver' }, 'trip_cancelled', `งาน ${t.code} ถูกยกเลิก: ${reason}`, '/driver', conn)
        for (const s of stops) await notify({ role: 'branch', branchId: s.branch_id }, 'trip_cancelled', `${s.code} ถูกถอดจากเที่ยว ${t.code} · รอจัดรถใหม่`, `/branch/requests/${s.request_id}`, conn)
        return { id: t.id, driverId: t.driver_id, branches: [...new Set(stops.map((s) => `branch:${s.branch_id}`))] }
    })
    emit(['ops', `driver:${out.driverId}`, ...out.branches], 'trip_changed', { tripId: out.id })
    emit('ops', 'requests_changed', {})
    res.json({ ok: true, status: 'cancelled' })
}))

router.post('/trips/:id/accept', authCheck, requireRole('driver'), handle(async (req, res) => {
    await transaction(async (conn) => {
        const t = await loadTrip(Number(req.params.id), req.user, conn, true)
        if (t.status !== 'assigned') fail(409, 'รับงานนี้ไปแล้ว')
        await query("UPDATE trip SET status = 'accepted' WHERE id = ?", [t.id], conn)
        await notify({ role: 'admin' }, 'trip_accepted', `${req.user.name} รับงาน ${t.code} แล้ว`, `/admin/trips/${t.id}`, conn)
    })
    emit('ops', 'trip_changed', { tripId: Number(req.params.id) })
    res.json({ ok: true, status: 'accepted' })
}))

/**
 * คนขับกดออกเดินทาง: ของออกจากคลังจริง
 *  - สต็อกคลังลด และปลดยอดจอง (reason = dispatch)
 *  - คำขอทุกจุดเป็น "กำลังจัดส่ง" และคำนวณเวลาถึงโดยประมาณ
 */
router.post('/trips/:id/start', authCheck, requireRole('driver'), handle(async (req, res) => {
    const out = await transaction(async (conn) => {
        const t = await loadTrip(Number(req.params.id), req.user, conn, true)
        if (t.status !== 'accepted') fail(409, t.status === 'assigned' ? 'กดรับงานก่อนออกเดินทาง' : 'เที่ยวนี้ออกเดินทางไปแล้ว')
        const busy = await one("SELECT code FROM trip WHERE driver_id = ? AND status = 'on_route' AND id <> ?", [req.user.id, t.id], conn)
        if (busy) fail(409, `ยังมีเที่ยว ${busy.code} ที่ส่งไม่เสร็จ`)

        const stops = await query(
            `SELECT ts.id, ts.request_id, r.code, r.branch_id, b.name, b.lat, b.lng FROM trip_stop ts
             JOIN replenish_request r ON r.id = ts.request_id JOIN branch b ON b.id = r.branch_id
             WHERE ts.trip_id = ? ORDER BY ts.seq`,
            [t.id],
            conn
        )
        const items = await query('SELECT product_id, SUM(qty_approved) AS qty FROM request_item WHERE request_id IN (?) AND qty_approved > 0 GROUP BY product_id', [stops.map((s) => s.request_id)], conn)
        await query('SELECT product_id FROM warehouse_stock WHERE product_id IN (?) FOR UPDATE', [items.map((i) => i.product_id).concat(0)], conn)
        for (const it of items) {
            await query('UPDATE warehouse_stock SET qty = qty - ?, reserved_qty = reserved_qty - ? WHERE product_id = ?', [it.qty, it.qty, it.product_id], conn)
            await query(
                "INSERT INTO stock_movement (branch_id, product_id, `change`, reason, ref_type, ref_id, user_id) VALUES (NULL, ?, ?, 'dispatch', 'trip', ?, ?)",
                [it.product_id, -it.qty, t.id, req.user.id],
                conn
            )
        }

        const wh = await warehouse()
        const etas = estimateEtas(wh, stops)
        for (let i = 0; i < stops.length; i++) {
            await query('UPDATE trip_stop SET eta = ? WHERE id = ?', [etas[i].eta, stops[i].id], conn)
            await query("UPDATE replenish_request SET status = 'in_transit' WHERE id = ?", [stops[i].request_id], conn)
            const hhmm = etas[i].eta.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
            await notify({ role: 'branch', branchId: stops[i].branch_id }, 'trip_started', `${t.code} ออกจากคลังแล้ว · ถึงสาขาประมาณ ${hhmm}`, `/branch/track/${t.id}`, conn)
        }
        await query("UPDATE trip SET status = 'on_route', started_at = UTC_TIMESTAMP(3) WHERE id = ?", [t.id], conn)
        await query("UPDATE vehicle SET status = 'in_use' WHERE id = ?", [t.vehicle_id], conn)
        return { id: t.id, branches: stops.map((s) => `branch:${s.branch_id}`) }
    })
    emit(['ops', ...out.branches], 'trip_changed', { tripId: out.id })
    res.json({ ok: true, status: 'on_route' })
}))

/**
 * มือถือคนขับส่งพิกัดทุก 5–10 วินาที
 * ส่งต่อแบบ real-time เฉพาะ ops และสาขาที่ยังรอของจากเที่ยวนี้
 */
router.post('/trips/:id/location', authCheck, requireRole('driver'), handle(async (req, res) => {
    const lat = Number(req.body?.lat)
    const lng = Number(req.body?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'พิกัดไม่ถูกต้อง')
    const speed = Number.isFinite(Number(req.body?.speed)) ? Number(req.body.speed) : null
    const t = await loadTrip(Number(req.params.id), req.user)
    if (t.status !== 'on_route') fail(409, 'ส่งพิกัดได้เฉพาะตอนกำลังเดินทาง')
    await query('INSERT INTO location_ping (trip_id, lat, lng, speed) VALUES (?, ?, ?, ?)', [t.id, lat, lng, speed])
    const payload = { tripId: t.id, code: t.code, lat, lng, speed, at: new Date().toISOString() }
    emit(['ops', ...(await branchRoomsOfTrip(t.id))], 'truck_location', payload)
    res.status(201).json({ ok: true })
}))

router.post('/trips/:id/stops/:stopId/arrive', authCheck, requireRole('driver'), handle(async (req, res) => {
    const out = await transaction(async (conn) => {
        const t = await loadTrip(Number(req.params.id), req.user, conn, true)
        if (t.status !== 'on_route') fail(409, 'ต้องออกเดินทางก่อน')
        const stop = await one(
            'SELECT ts.*, r.branch_id, r.code, b.name FROM trip_stop ts JOIN replenish_request r ON r.id = ts.request_id JOIN branch b ON b.id = r.branch_id WHERE ts.id = ? AND ts.trip_id = ? FOR UPDATE',
            [Number(req.params.stopId), t.id],
            conn
        )
        if (!stop) fail(404, 'ไม่พบจุดส่ง')
        if (stop.status !== 'pending') fail(409, 'กดถึงจุดนี้ไปแล้ว')
        await query("UPDATE trip_stop SET status = 'arrived', arrived_at = UTC_TIMESTAMP(3), proof_url = ? WHERE id = ?", [req.body?.proof_url || null, stop.id], conn)
        await notify({ role: 'branch', branchId: stop.branch_id }, 'truck_arrived', `รถ ${t.code} ถึงสาขาแล้ว · กรุณานับและยืนยันรับของ ${stop.code}`, `/branch/receive/${stop.request_id}`, conn)
        return { branchId: stop.branch_id, tripId: t.id }
    })
    emit(['ops', `branch:${out.branchId}`], 'trip_changed', { tripId: out.tripId })
    res.json({ ok: true, status: 'arrived' })
}))

module.exports = router
