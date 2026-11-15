const router = require('express').Router()
const { query, one, transaction } = require('../config/db')
const { fail, handle, posInt } = require('../config/errors')
const { authCheck, requireRole, assertBranchAccess } = require('../middlewares/auth')
const { notify } = require('../services/notify')
const { emit } = require('../services/realtime')
const { requestCode } = require('../services/codes')

const STATUSES = ['draft', 'pending', 'approved', 'in_transit', 'received', 'rejected', 'cancelled']

const loadRequest = async (id, user, conn, lock = false) => {
    const r = await one(`SELECT * FROM replenish_request WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id], conn)
    if (!r) fail(404, 'ไม่พบคำขอ')
    assertBranchAccess(user, r.branch_id)
    return r
}

// แปลง [{product_id, qty}] → Map ตรวจซ้ำและค่าที่ไม่ถูกต้อง
const parseItems = (items, field = 'qty', allowZero = false) => {
    if (!Array.isArray(items) || !items.length) fail(400, 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ')
    const map = new Map()
    for (const it of items) {
        const pid = posInt(it.product_id, 'product_id')
        if (map.has(pid)) fail(400, `สินค้า #${pid} ซ้ำในรายการ`)
        map.set(pid, posInt(it[field], field, { allowZero }))
    }
    return map
}

router.get('/requests', authCheck, handle(async (req, res) => {
    const where = []
    const params = []
    if (req.user.role === 'branch') {
        where.push('r.branch_id = ?')
        params.push(req.user.branchId)
    } else if (req.user.role === 'driver') {
        fail(403, 'ไม่มีสิทธิ์ดูคำขอ')
    } else if (req.query.branch_id) {
        where.push('r.branch_id = ?')
        params.push(Number(req.query.branch_id))
    }
    if (req.query.status) {
        const list = String(req.query.status).split(',').filter((s) => STATUSES.includes(s))
        if (list.length) {
            where.push('r.status IN (?)')
            params.push(list)
        }
    }
    const rows = await query(
        `SELECT r.id, r.code, r.branch_id AS branchId, b.name AS branchName, b.region, r.source, r.status, r.priority,
                SUM(COALESCE(ri.qty_approved, ri.qty_requested)) AS totalQty,
                SUM(ri.qty_received IS NOT NULL AND (ri.qty_damaged > 0 OR ri.qty_received + ri.qty_damaged < ri.qty_approved)) AS issueCount,
                COALESCE(MAX(bs.qty <= 0), 0) AS hasOut,
                r.created_at AS createdAt, r.submitted_at AS submittedAt, r.auto_submit_at AS autoSubmitAt,
                COUNT(ri.product_id) AS itemCount,
                ROUND(SUM(COALESCE(ri.qty_approved, ri.qty_requested) * p.weight_kg) / 1000, 3) AS weightTon,
                t.code AS tripCode, ts.status AS stopStatus
         FROM replenish_request r
         JOIN branch b ON b.id = r.branch_id
         LEFT JOIN request_item ri ON ri.request_id = r.id
         LEFT JOIN product p ON p.id = ri.product_id
         LEFT JOIN branch_stock bs ON bs.branch_id = r.branch_id AND bs.product_id = ri.product_id
         LEFT JOIN trip_stop ts ON ts.request_id = r.id
         LEFT JOIN trip t ON t.id = ts.trip_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         GROUP BY r.id
         ORDER BY (r.priority = 'urgent') DESC, r.created_at DESC
         LIMIT 300`,
        params
    )
    res.json(rows)
}))

router.get('/requests/:id', authCheck, handle(async (req, res) => {
    if (req.user.role === 'driver') fail(403, 'ไม่มีสิทธิ์ดูคำขอ')
    const r = await loadRequest(Number(req.params.id), req.user)
    const items = await query(
        `SELECT ri.product_id AS productId, p.sku, p.name, p.unit,
                ri.qty_requested AS qtyRequested, ri.qty_approved AS qtyApproved,
                ri.qty_received AS qtyReceived, ri.qty_damaged AS qtyDamaged,
                bs.qty AS branchQty, bs.reorder_point AS reorderPoint, bs.max_qty AS maxQty,
                ws.qty - ws.reserved_qty AS warehouseAvailable
         FROM request_item ri
         JOIN product p ON p.id = ri.product_id
         LEFT JOIN branch_stock bs ON bs.branch_id = ? AND bs.product_id = ri.product_id
         LEFT JOIN warehouse_stock ws ON ws.product_id = ri.product_id
         WHERE ri.request_id = ? ORDER BY p.sku`,
        [r.branch_id, r.id]
    )
    const branch = await one('SELECT id, code, name FROM branch WHERE id = ?', [r.branch_id])
    const stop = await one(
        'SELECT ts.id, ts.status, ts.seq, ts.eta, ts.arrived_at AS arrivedAt, ts.received_at AS receivedAt, t.id AS tripId, t.code AS tripCode, t.status AS tripStatus, t.started_at AS startedAt, t.created_at AS assignedAt FROM trip_stop ts JOIN trip t ON t.id = ts.trip_id WHERE ts.request_id = ?',
        [r.id]
    )
    // สาขาไม่จำเป็นต้องเห็นยอดคงคลังกลาง
    const safeItems = req.user.role === 'branch' ? items.map(({ warehouseAvailable, ...rest }) => rest) : items
    res.json({ ...r, branch, items: safeItems, stop })
}))

// สาขาสั่งเอง (source = branch) หรือ Admin เสนอเติมให้สาขา (source = hq) → รออนุมัติ
router.post('/requests', authCheck, requireRole('branch', 'admin'), handle(async (req, res) => {
    const branchId = req.user.role === 'branch' ? req.user.branchId : posInt(req.body?.branch_id, 'branch_id')
    const items = parseItems(req.body?.items)
    const priority = req.body?.priority === 'urgent' ? 'urgent' : 'normal'

    const created = await transaction(async (conn) => {
        const br = await one('SELECT active, is_warehouse FROM branch WHERE id = ?', [branchId], conn)
        if (!br || br.is_warehouse) fail(404, 'ไม่พบสาขา')
        if (!br.active) fail(409, 'สาขานี้ปิดแล้ว')
        const found = await query('SELECT id FROM product WHERE id IN (?)', [[...items.keys()]], conn)
        if (found.length !== items.size) fail(400, 'มีรหัสสินค้าที่ไม่มีในระบบ')
        const ins = await query(
            `INSERT INTO replenish_request (code, branch_id, source, status, priority, note, created_by, submitted_at)
             VALUES ('tmp', ?, ?, 'pending', ?, ?, ?, UTC_TIMESTAMP(3))`,
            [branchId, req.user.role === 'branch' ? 'branch' : 'hq', priority, (req.body?.note || '').slice(0, 255) || null, req.user.id],
            conn
        )
        const code = requestCode(ins.insertId)
        await query('UPDATE replenish_request SET code = ? WHERE id = ?', [code, ins.insertId], conn)
        await query('INSERT INTO request_item (request_id, product_id, qty_requested) VALUES ?', [[...items].map(([p, q]) => [ins.insertId, p, q])], conn)
        if (req.user.role === 'branch') {
            await notify({ role: 'admin' }, 'request_submitted', `${code} สาขาสั่งเอง${priority === 'urgent' ? ' (ด่วน)' : ''}`, `/admin/requests/${ins.insertId}`, conn)
        } else {
            await notify({ role: 'branch', branchId }, 'hq_proposal', `คลังเสนอเติมของให้สาขา ${code}`, `/branch/requests/${ins.insertId}`, conn)
        }
        return { id: ins.insertId, code }
    })
    emit('ops', 'requests_changed', {})
    res.status(201).json(created)
}))

// สาขาแก้ร่างหรือคำขอที่ยังไม่อนุมัติ: จำนวน 0 = เอาออก
router.patch('/requests/:id', authCheck, requireRole('branch'), handle(async (req, res) => {
    await transaction(async (conn) => {
        const r = await loadRequest(Number(req.params.id), req.user, conn, true)
        if (!['draft', 'pending'].includes(r.status)) fail(409, 'แก้ไขได้เฉพาะคำขอที่ยังไม่อนุมัติ')
        if (req.body?.items) {
            const items = parseItems(req.body.items, 'qty', true)
            for (const [pid, qty] of items) {
                if (qty === 0) await query('DELETE FROM request_item WHERE request_id = ? AND product_id = ?', [r.id, pid], conn)
                else await query(
                    'INSERT INTO request_item (request_id, product_id, qty_requested) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty_requested = VALUES(qty_requested)',
                    [r.id, pid, qty],
                    conn
                )
            }
            const left = await one('SELECT COUNT(*) AS n FROM request_item WHERE request_id = ?', [r.id], conn)
            if (!left.n) fail(400, 'คำขอต้องมีอย่างน้อย 1 รายการ')
        }
        if (req.body?.priority) await query('UPDATE replenish_request SET priority = ? WHERE id = ?', [req.body.priority === 'urgent' ? 'urgent' : 'normal', r.id], conn)
        if (req.body?.note !== undefined) await query('UPDATE replenish_request SET note = ? WHERE id = ?', [String(req.body.note).slice(0, 255) || null, r.id], conn)
    })
    res.json({ ok: true })
}))

// สาขายืนยันร่างที่ระบบสร้าง → ส่งเข้าคลัง
router.post('/requests/:id/submit', authCheck, requireRole('branch'), handle(async (req, res) => {
    const r = await transaction(async (conn) => {
        const r = await loadRequest(Number(req.params.id), req.user, conn, true)
        if (r.status !== 'draft') fail(409, 'คำขอนี้ถูกส่งไปแล้ว')
        await query("UPDATE replenish_request SET status = 'pending', submitted_at = UTC_TIMESTAMP(3), created_by = ? WHERE id = ?", [req.user.id, r.id], conn)
        await notify({ role: 'admin' }, 'request_submitted', `${r.code} สาขายืนยันคำขอแล้ว${r.priority === 'urgent' ? ' (ด่วน)' : ''}`, `/admin/requests/${r.id}`, conn)
        return r
    })
    emit('ops', 'requests_changed', {})
    res.json({ id: r.id, status: 'pending' })
}))

/**
 * Admin อนุมัติ: จองสต็อกคลังตามจำนวนที่อนุมัติ
 * ล็อกแถวสต็อกคลังด้วย FOR UPDATE กัน Admin สองคนอนุมัติพร้อมกันจนจองเกินของที่มี
 */
router.post('/requests/:id/approve', authCheck, requireRole('admin'), handle(async (req, res) => {
    const result = await transaction(async (conn) => {
        const r = await loadRequest(Number(req.params.id), req.user, conn, true)
        if (r.status !== 'pending') fail(409, 'อนุมัติได้เฉพาะคำขอที่รออนุมัติ')
        const items = await query('SELECT product_id, qty_requested FROM request_item WHERE request_id = ?', [r.id], conn)
        const override = req.body?.items ? parseItems(req.body.items, 'qty_approved', true) : new Map()
        for (const pid of override.keys()) if (!items.some((i) => i.product_id === pid)) fail(400, `สินค้า #${pid} ไม่อยู่ในคำขอนี้`)

        const approved = items.map((i) => ({ pid: i.product_id, qty: override.has(i.product_id) ? override.get(i.product_id) : i.qty_requested }))
        if (!approved.some((a) => a.qty > 0)) fail(400, 'ต้องอนุมัติอย่างน้อย 1 รายการ ถ้าไม่ต้องการส่งให้ใช้ปฏิเสธ')

        const stock = await query(
            `SELECT ws.product_id, ws.qty, ws.reserved_qty, p.name FROM warehouse_stock ws JOIN product p ON p.id = ws.product_id
             WHERE ws.product_id IN (?) FOR UPDATE`,
            [approved.map((a) => a.pid)],
            conn
        )
        const byId = new Map(stock.map((s) => [s.product_id, s]))
        const short = approved
            .filter((a) => a.qty > 0)
            .map((a) => ({ ...a, s: byId.get(a.pid) }))
            .filter((a) => !a.s || a.qty > a.s.qty - a.s.reserved_qty)
            .map((a) => ({ productId: a.pid, name: a.s?.name, approved: a.qty, available: a.s ? a.s.qty - a.s.reserved_qty : 0 }))
        if (short.length) fail(409, 'สต็อกคลังไม่พอสำหรับบางรายการ ลดจำนวนหรือจัดสรรก่อน', short)
        const over = approved.filter((a) => a.qty > items.find((i) => i.product_id === a.pid).qty_requested)
        if (over.length) fail(400, 'อนุมัติได้ไม่เกินจำนวนที่สาขาขอ')

        for (const a of approved) {
            await query('UPDATE request_item SET qty_approved = ? WHERE request_id = ? AND product_id = ?', [a.qty, r.id, a.pid], conn)
            if (a.qty > 0) await query('UPDATE warehouse_stock SET reserved_qty = reserved_qty + ? WHERE product_id = ?', [a.qty, a.pid], conn)
        }
        await query("UPDATE replenish_request SET status = 'approved', approved_by = ?, approved_at = UTC_TIMESTAMP(3) WHERE id = ?", [req.user.id, r.id], conn)
        const reduced = approved.filter((a) => a.qty < items.find((i) => i.product_id === a.pid).qty_requested).length
        await notify({ role: 'branch', branchId: r.branch_id }, 'request_approved',
            `${r.code} อนุมัติแล้ว${reduced ? ` (ปรับลด ${reduced} รายการเพราะคลังมีไม่พอ)` : ''} · รอจัดรถ`, `/branch/requests/${r.id}`, conn)
        return { id: r.id, branchId: r.branch_id, status: 'approved', items: approved.map((a) => ({ productId: a.pid, qtyApproved: a.qty })) }
    })
    emit(['ops', `branch:${result.branchId}`], 'requests_changed', {})
    res.json(result)
}))

router.post('/requests/:id/reject', authCheck, requireRole('admin'), handle(async (req, res) => {
    const reason = String(req.body?.reason || '').trim()
    if (!reason) fail(400, 'ระบุเหตุผลที่ปฏิเสธ')
    await transaction(async (conn) => {
        const r = await loadRequest(Number(req.params.id), req.user, conn, true)
        if (r.status !== 'pending') fail(409, 'ปฏิเสธได้เฉพาะคำขอที่รออนุมัติ')
        await query("UPDATE replenish_request SET status = 'rejected', note = ? WHERE id = ?", [reason.slice(0, 255), r.id], conn)
        await notify({ role: 'branch', branchId: r.branch_id }, 'request_rejected', `${r.code} ถูกปฏิเสธ: ${reason}`, `/branch/requests/${r.id}`, conn)
    })
    emit('ops', 'requests_changed', {})
    res.json({ ok: true })
}))

/**
 * ยกเลิกคำขอ
 *  - สาขา: ยกเลิกคำขอของตัวเองที่ยังไม่อนุมัติ (ร่าง / รออนุมัติ)
 *  - Admin: ยกเลิกคำขอที่อนุมัติแล้วแต่ยังไม่ได้จัดเข้าเที่ยว → คืนยอดจองให้คลัง
 *    (คำขอที่รออนุมัติให้ใช้ "ปฏิเสธ" ส่วนคำขอที่อยู่ในเที่ยวต้องยกเลิกเที่ยวก่อน)
 * ถ้าสินค้ายังใกล้หมด ระบบจะร่างคำขอใหม่ให้เองในรอบสแกนถัดไป
 */
router.post('/requests/:id/cancel', authCheck, requireRole('branch', 'admin'), handle(async (req, res) => {
    const reason = String(req.body?.reason || '').trim().slice(0, 255)
    const out = await transaction(async (conn) => {
        const r = await loadRequest(Number(req.params.id), req.user, conn, true)
        if (req.user.role === 'branch') {
            if (!['draft', 'pending'].includes(r.status)) fail(409, 'ยกเลิกได้เฉพาะคำขอที่ยังไม่อนุมัติ ถ้าอนุมัติแล้วให้ติดต่อคลังกลาง')
        } else {
            if (r.status === 'pending') fail(409, 'คำขอที่รออนุมัติให้ใช้ปุ่มปฏิเสธ')
            if (r.status !== 'approved') fail(409, 'ยกเลิกได้เฉพาะคำขอที่อนุมัติแล้วแต่ยังไม่ออกจากคลัง')
            if (!reason) fail(400, 'ระบุเหตุผลที่ยกเลิก')
            const stop = await one('SELECT t.code FROM trip_stop ts JOIN trip t ON t.id = ts.trip_id WHERE ts.request_id = ?', [r.id], conn)
            if (stop) fail(409, `คำขอนี้อยู่ในเที่ยว ${stop.code} ยกเลิกเที่ยวก่อน`)
            const items = await query('SELECT product_id, qty_approved FROM request_item WHERE request_id = ? AND qty_approved > 0', [r.id], conn)
            if (items.length) await query('SELECT product_id FROM warehouse_stock WHERE product_id IN (?) FOR UPDATE', [items.map((i) => i.product_id)], conn)
            for (const it of items) {
                await query('UPDATE warehouse_stock SET reserved_qty = GREATEST(reserved_qty - ?, 0) WHERE product_id = ?', [it.qty_approved, it.product_id], conn)
            }
        }
        await query("UPDATE replenish_request SET status = 'cancelled', note = COALESCE(?, note) WHERE id = ?", [reason || null, r.id], conn)
        if (req.user.role === 'branch') {
            if (r.status === 'pending') await notify({ role: 'admin' }, 'request_cancelled', `${r.code} สาขายกเลิกคำขอ${reason ? `: ${reason}` : ''}`, `/admin/requests/${r.id}`, conn)
        } else {
            await notify({ role: 'branch', branchId: r.branch_id }, 'request_cancelled', `${r.code} ถูกยกเลิกโดยคลังกลาง: ${reason}`, `/branch/requests/${r.id}`, conn)
        }
        return { id: r.id, branchId: r.branch_id }
    })
    emit(['ops', `branch:${out.branchId}`], 'requests_changed', {})
    res.json({ id: out.id, status: 'cancelled' })
}))

/**
 * สาขานับและยืนยันรับของ (สาขาเป็นคนปิดงาน ไม่ใช่คนขับ)
 * qty_received = ของดีที่รับเข้าสต็อก, qty_damaged = ของเสียหาย (ไม่เข้าสต็อก)
 * ส่วนที่เหลือจาก qty_approved = ขาด
 */
router.post('/requests/:id/receive', authCheck, requireRole('branch'), handle(async (req, res) => {
    const out = await transaction(async (conn) => {
        const r = await loadRequest(Number(req.params.id), req.user, conn, true)
        if (r.status !== 'in_transit') fail(409, 'คำขอนี้ยังไม่ได้อยู่ระหว่างจัดส่ง')
        const stop = await one('SELECT * FROM trip_stop WHERE request_id = ? FOR UPDATE', [r.id], conn)
        if (!stop || stop.status !== 'arrived') fail(409, 'รถยังไม่ถึงสาขา (คนขับต้องกด "ถึงสาขาแล้ว" ก่อน)')

        const items = await query('SELECT ri.product_id, ri.qty_approved, p.name FROM request_item ri JOIN product p ON p.id = ri.product_id WHERE request_id = ? AND qty_approved > 0', [r.id], conn)
        const given = new Map()
        for (const it of req.body?.items || []) {
            const pid = posInt(it.product_id, 'product_id')
            given.set(pid, { good: posInt(it.qty_received, 'qty_received', { allowZero: true }), damaged: posInt(it.qty_damaged || 0, 'qty_damaged', { allowZero: true }) })
        }
        const issues = []
        for (const it of items) {
            const g = given.get(it.product_id)
            if (!g) fail(400, `ยังไม่ได้นับ ${it.name}`)
            if (g.good + g.damaged > it.qty_approved) fail(400, `${it.name}: นับได้เกินจำนวนที่ส่งมา (${it.qty_approved})`)
            await query('UPDATE request_item SET qty_received = ?, qty_damaged = ? WHERE request_id = ? AND product_id = ?', [g.good, g.damaged, r.id, it.product_id], conn)
            if (g.good > 0) {
                await query(
                    'INSERT INTO branch_stock (branch_id, product_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)',
                    [r.branch_id, it.product_id, g.good],
                    conn
                )
                await query(
                    "INSERT INTO stock_movement (branch_id, product_id, `change`, reason, ref_type, ref_id, user_id) VALUES (?, ?, ?, 'receive', 'request', ?, ?)",
                    [r.branch_id, it.product_id, g.good, r.id, req.user.id],
                    conn
                )
            }
            const missing = it.qty_approved - g.good - g.damaged
            if (missing || g.damaged) issues.push(`${it.name}${missing ? ` ขาด ${missing}` : ''}${g.damaged ? ` เสียหาย ${g.damaged}` : ''}`)
        }

        await query("UPDATE replenish_request SET status = 'received', received_at = UTC_TIMESTAMP(3) WHERE id = ?", [r.id], conn)
        await query("UPDATE trip_stop SET status = 'received', received_at = UTC_TIMESTAMP(3) WHERE id = ?", [stop.id], conn)

        const left = await one("SELECT COUNT(*) AS n FROM trip_stop WHERE trip_id = ? AND status <> 'received'", [stop.trip_id], conn)
        const trip = await one('SELECT id, code, vehicle_id, driver_id FROM trip WHERE id = ?', [stop.trip_id], conn)
        if (!left.n) {
            await query("UPDATE trip SET status = 'completed', finished_at = UTC_TIMESTAMP(3) WHERE id = ?", [trip.id], conn)
            await query("UPDATE vehicle SET status = 'available' WHERE id = ?", [trip.vehicle_id], conn)
            await notify({ role: 'admin' }, 'trip_completed', `${trip.code} ส่งครบทุกจุดแล้ว`, `/admin/trips/${trip.id}`, conn)
        }
        const b = await one('SELECT name FROM branch WHERE id = ?', [r.branch_id], conn)
        if (issues.length) await notify({ role: 'admin' }, 'receive_issue', `สาขา${b.name}รับของไม่ครบ ${r.code}: ${issues.join(', ')}`, `/admin/requests/${r.id}`, conn)
        await notify({ userId: trip.driver_id, role: 'driver' }, 'stop_received', `สาขา${b.name}ยืนยันรับของแล้ว`, `/driver/trips/${trip.id}`, conn)
        return { id: r.id, status: 'received', issues, tripCompleted: !left.n, tripId: trip.id }
    })
    emit(['ops', `branch:${req.user.branchId}`], 'trip_changed', { tripId: out.tripId })
    res.json(out)
}))

module.exports = router
