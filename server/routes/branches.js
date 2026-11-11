const router = require('express').Router()
const { query, one, transaction } = require('../config/db')
const { fail, handle, posInt } = require('../config/errors')
const { authCheck, requireRole, assertBranchAccess } = require('../middlewares/auth')
const { checkLowStock } = require('../services/replenish')
const { notify } = require('../services/notify')
const { emit } = require('../services/realtime')

router.get('/products', authCheck, handle(async (req, res) => {
    res.json(await query('SELECT id, sku, name, category, unit, weight_kg AS weightKg, price FROM product ORDER BY sku'))
}))

router.get('/branches', authCheck, handle(async (req, res) => {
    const where = req.user.role === 'branch' ? 'WHERE id = ?' : ''
    res.json(await query(
        `SELECT b.id, b.code, b.name, b.region, b.address, b.lat, b.lng, b.is_warehouse AS isWarehouse,
                COALESCE(SUM(bs.qty <= 0), 0) AS outItems, COALESCE(SUM(bs.qty > 0 AND bs.qty <= bs.reorder_point), 0) AS lowItems
         FROM branch b LEFT JOIN branch_stock bs ON bs.branch_id = b.id
         ${where.replace('id', 'b.id')} GROUP BY b.id ORDER BY b.is_warehouse DESC, b.name`,
        [req.user.branchId]
    ))
}))

// สต็อกสาขา + สถานะ + ของที่กำลังมา + คำขอที่เปิดอยู่ของแต่ละสินค้า
router.get('/branches/:id/stock', authCheck, handle(async (req, res) => {
    const branchId = Number(req.params.id)
    assertBranchAccess(req.user, branchId)
    const rows = await query(
        `SELECT p.id AS productId, p.sku, p.name, p.category, p.unit,
                bs.qty, bs.reorder_point AS reorderPoint, bs.max_qty AS maxQty,
                COALESCE(inc.incoming, 0) AS incoming, COALESCE(inc.requested, 0) AS requested, inc.requestCode, inc.requestStatus
         FROM branch_stock bs
         JOIN product p ON p.id = bs.product_id
         LEFT JOIN (
             SELECT ri.product_id,
                    SUM(CASE WHEN r.status IN ('approved','in_transit') THEN COALESCE(ri.qty_approved, 0) ELSE 0 END) AS incoming,
                    SUM(CASE WHEN r.status IN ('draft','pending') THEN ri.qty_requested ELSE 0 END) AS requested,
                    MAX(r.code) AS requestCode, MAX(r.status) AS requestStatus
             FROM request_item ri JOIN replenish_request r ON r.id = ri.request_id
             WHERE r.branch_id = ? AND r.status IN ('draft','pending','approved','in_transit')
             GROUP BY ri.product_id
         ) inc ON inc.product_id = bs.product_id
         WHERE bs.branch_id = ?
         ORDER BY (bs.qty <= 0) DESC, (bs.qty <= bs.reorder_point) DESC, bs.qty / NULLIF(bs.max_qty, 0), p.sku`,
        [branchId, branchId]
    )
    res.json(rows.map((r) => ({ ...r, status: r.qty <= 0 ? 'out' : r.qty <= r.reorderPoint ? 'low' : 'ok' })))
}))

/**
 * POS ส่งบิลขายมาที่นี่ → ตัดสต็อกสาขา
 * เรียกได้สองทาง: พนักงานสาขาที่ล็อกอิน หรือเครื่อง POS ที่ส่ง header X-POS-Key
 *
 * - bill_id ห้ามซ้ำ: POS ส่งบิลเดิมซ้ำ (เน็ตหลุดแล้วส่งใหม่) จะไม่ถูกตัดสต็อกสองครั้ง
 * - ไม่ปฏิเสธการขายแม้สต็อกในระบบไม่พอ (ของจริงอยู่บนชั้นแล้ว) แต่แจ้งให้สาขานับสต็อก
 * - หลังตัดสต็อก ตรวจว่ามีสินค้าใกล้หมดไหม แล้วร่างคำขอให้อัตโนมัติ
 */
const posAuth = (req, res, next) => {
    const key = req.get('X-POS-Key')
    if (key && process.env.POS_API_KEY && key === process.env.POS_API_KEY) {
        req.user = { role: 'pos' }
        return next()
    }
    return authCheck(req, res, next)
}

router.post('/branches/:id/sales', posAuth, handle(async (req, res) => {
    const branchId = Number(req.params.id)
    if (req.user.role !== 'pos') {
        if (req.user.role !== 'branch') fail(403, 'บันทึกยอดขายได้เฉพาะสาขาหรือเครื่อง POS')
        assertBranchAccess(req.user, branchId)
    }
    const { bill_id: billId, sold_at: soldAt, items } = req.body || {}
    if (!billId || typeof billId !== 'string' || billId.length > 40) fail(400, 'ต้องมี bill_id (ไม่เกิน 40 ตัวอักษร)')
    if (!Array.isArray(items) || !items.length) fail(400, 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ')

    const lines = new Map()
    for (const it of items) {
        const pid = posInt(it.product_id, 'product_id')
        lines.set(pid, (lines.get(pid) || 0) + posInt(it.qty, 'qty'))
    }

    const result = await transaction(async (conn) => {
        const branch = await one('SELECT id FROM branch WHERE id = ? AND is_warehouse = 0', [branchId], conn)
        if (!branch) fail(404, 'ไม่พบสาขา')
        const found = await query('SELECT id FROM product WHERE id IN (?)', [[...lines.keys()]], conn)
        if (found.length !== lines.size) fail(400, 'มีรหัสสินค้าที่ไม่มีในระบบ')

        const ins = await query(
            'INSERT IGNORE INTO pos_sale (bill_id, branch_id, total_items, sold_at) VALUES (?, ?, ?, ?)',
            [billId, branchId, [...lines.values()].reduce((a, b) => a + b, 0), soldAt ? new Date(soldAt) : new Date()],
            conn
        )
        if (ins.affectedRows === 0) return { duplicate: true }

        for (const [pid, qty] of lines) {
            await query(
                'INSERT INTO branch_stock (branch_id, product_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)',
                [branchId, pid, -qty],
                conn
            )
            await query(
                "INSERT INTO stock_movement (branch_id, product_id, `change`, reason, ref_type, note) VALUES (?, ?, ?, 'sale', 'bill', ?)",
                [branchId, pid, -qty, billId],
                conn
            )
        }

        const negative = await query(
            'SELECT p.name FROM branch_stock bs JOIN product p ON p.id = bs.product_id WHERE bs.branch_id = ? AND bs.product_id IN (?) AND bs.qty < 0',
            [branchId, [...lines.keys()]],
            conn
        )
        if (negative.length) {
            await notify({ role: 'branch', branchId }, 'count_needed', `สต็อกในระบบติดลบ: ${negative.map((n) => n.name).join(', ')} · กรุณานับสต็อกใหม่`, '/branch/stock-count', conn)
        }
        const draft = await checkLowStock(conn, branchId, [...lines.keys()])
        return { duplicate: false, draft }
    })

    if (!result.duplicate) emit([`branch:${branchId}`, 'ops'], 'stock_changed', { branchId })
    res.status(result.duplicate ? 200 : 201).json({ billId, ...result })
}))

// นับสต็อกจริงแล้วปรับยอดให้ตรง (reason = adjust)
router.post('/branches/:id/stock-count', authCheck, requireRole('branch'), handle(async (req, res) => {
    const branchId = Number(req.params.id)
    assertBranchAccess(req.user, branchId)
    const items = req.body?.items
    if (!Array.isArray(items) || !items.length) fail(400, 'ต้องมีรายการที่นับอย่างน้อย 1 รายการ')

    const diffs = await transaction(async (conn) => {
        const out = []
        for (const it of items) {
            const pid = posInt(it.product_id, 'product_id')
            const counted = posInt(it.counted, 'counted', { allowZero: true })
            const row = await one('SELECT qty FROM branch_stock WHERE branch_id = ? AND product_id = ? FOR UPDATE', [branchId, pid], conn)
            if (!row) fail(400, `สาขานี้ไม่มีสินค้า #${pid}`)
            const diff = counted - row.qty
            if (diff !== 0) {
                await query('UPDATE branch_stock SET qty = ? WHERE branch_id = ? AND product_id = ?', [counted, branchId, pid], conn)
                await query(
                    "INSERT INTO stock_movement (branch_id, product_id, `change`, reason, user_id, note) VALUES (?, ?, ?, 'adjust', ?, 'นับสต็อก')",
                    [branchId, pid, diff, req.user.id],
                    conn
                )
            }
            out.push({ productId: pid, before: row.qty, counted, diff })
        }
        await checkLowStock(conn, branchId, out.map((o) => o.productId))
        return out
    })
    emit([`branch:${branchId}`, 'ops'], 'stock_changed', { branchId })
    res.json({ items: diffs, adjusted: diffs.filter((d) => d.diff !== 0).length })
}))

// บันทึกของเสีย/หมดอายุ (reason = waste)
router.post('/branches/:id/waste', authCheck, requireRole('branch'), handle(async (req, res) => {
    const branchId = Number(req.params.id)
    assertBranchAccess(req.user, branchId)
    const pid = posInt(req.body?.product_id, 'product_id')
    const qty = posInt(req.body?.qty, 'qty')
    const why = { expired: 'หมดอายุ', damaged: 'เสียหาย', other: 'อื่น ๆ' }[req.body?.reason]
    if (!why) fail(400, 'reason ต้องเป็น expired, damaged หรือ other')

    await transaction(async (conn) => {
        const row = await one('SELECT qty FROM branch_stock WHERE branch_id = ? AND product_id = ? FOR UPDATE', [branchId, pid], conn)
        if (!row) fail(400, 'สาขานี้ไม่มีสินค้านี้')
        await query('UPDATE branch_stock SET qty = qty - ? WHERE branch_id = ? AND product_id = ?', [qty, branchId, pid], conn)
        await query(
            "INSERT INTO stock_movement (branch_id, product_id, `change`, reason, user_id, note) VALUES (?, ?, ?, 'waste', ?, ?)",
            [branchId, pid, -qty, req.user.id, [why, req.body?.note].filter(Boolean).join(' · ').slice(0, 255)],
            conn
        )
        await checkLowStock(conn, branchId, [pid])
    })
    emit([`branch:${branchId}`, 'ops'], 'stock_changed', { branchId })
    res.status(201).json({ ok: true })
}))

module.exports = router
