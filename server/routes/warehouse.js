const router = require('express').Router()
const { query, one, transaction } = require('../config/db')
const { fail, handle, posInt } = require('../config/errors')
const { authCheck, requireRole } = require('../middlewares/auth')
const { checkLowStock } = require('../services/replenish')
const { emit } = require('../services/realtime')

// สต็อกคลัง + รวมคำขอที่รออนุมัติของทุกสาขาตามสินค้า → เห็นทันทีว่าสินค้าไหนคลังไม่พอ
router.get('/warehouse/stock', authCheck, requireRole('admin', 'executive'), handle(async (req, res) => {
    const rows = await query(
        `SELECT p.id AS productId, p.sku, p.name, p.category, p.price, ws.qty, ws.reserved_qty AS reserved,
                ws.qty - ws.reserved_qty AS available, ws.reorder_point AS reorderPoint,
                COALESCE(d.requested, 0) AS requested, COALESCE(d.branches, 0) AS branches, COALESCE(d.urgent, 0) AS urgent
         FROM warehouse_stock ws JOIN product p ON p.id = ws.product_id
         LEFT JOIN (
             SELECT ri.product_id, SUM(ri.qty_requested) AS requested, COUNT(DISTINCT r.branch_id) AS branches,
                    SUM(r.priority = 'urgent') AS urgent
             FROM request_item ri JOIN replenish_request r ON r.id = ri.request_id
             WHERE r.status = 'pending' GROUP BY ri.product_id
         ) d ON d.product_id = p.id
         ORDER BY (COALESCE(d.requested, 0) > ws.qty - ws.reserved_qty) DESC, d.requested DESC, p.sku`
    )
    res.json(rows.map((r) => ({ ...r, shortfall: Math.max(r.requested - r.available, 0), belowReorder: r.qty <= r.reorderPoint })))
}))

/**
 * ข้อเสนอการจัดสรรเมื่อคลังไม่พอ
 * เรียงคำขอ: ด่วนก่อน → สาขาที่เหลือของน้อยเมื่อเทียบกับเพดานก่อน → ส่งคำขอก่อนได้ก่อน
 * แล้วแจกทีละสาขาจนของหมด (อธิบายง่าย และสาขาที่ของหมดได้ก่อนเสมอ)
 */
router.get('/warehouse/allocation/:productId', authCheck, requireRole('admin'), handle(async (req, res) => {
    const pid = posInt(req.params.productId, 'productId')
    const stock = await one('SELECT p.name, p.sku, ws.qty - ws.reserved_qty AS available FROM warehouse_stock ws JOIN product p ON p.id = ws.product_id WHERE ws.product_id = ?', [pid])
    if (!stock) fail(404, 'ไม่พบสินค้า')
    const rows = await query(
        `SELECT r.id AS requestId, r.code, r.priority, b.name AS branchName, ri.qty_requested AS requested,
                bs.qty AS branchQty, bs.max_qty AS maxQty
         FROM request_item ri JOIN replenish_request r ON r.id = ri.request_id JOIN branch b ON b.id = r.branch_id
         LEFT JOIN branch_stock bs ON bs.branch_id = r.branch_id AND bs.product_id = ri.product_id
         WHERE r.status = 'pending' AND ri.product_id = ?
         ORDER BY (r.priority = 'urgent') DESC, COALESCE(bs.qty / NULLIF(bs.max_qty, 0), 0), r.submitted_at`,
        [pid]
    )
    let left = Math.max(stock.available, 0)
    const plan = rows.map((r) => {
        const give = Math.min(r.requested, left)
        left -= give
        return { ...r, suggested: give }
    })
    res.json({ productId: pid, ...stock, requested: rows.reduce((s, r) => s + r.requested, 0), plan, leftover: left })
}))

// รับของเข้าคลัง (จำลองใบสั่งซื้อที่ซัพพลายเออร์ส่งมาถึง)
router.post('/warehouse/receive', authCheck, requireRole('admin'), handle(async (req, res) => {
    const pid = posInt(req.body?.product_id, 'product_id')
    const qty = posInt(req.body?.qty, 'qty')
    await transaction(async (conn) => {
        const row = await one('SELECT product_id FROM warehouse_stock WHERE product_id = ? FOR UPDATE', [pid], conn)
        if (!row) fail(404, 'ไม่พบสินค้า')
        await query('UPDATE warehouse_stock SET qty = qty + ? WHERE product_id = ?', [qty, pid], conn)
        await query("INSERT INTO stock_movement (branch_id, product_id, `change`, reason, user_id, note) VALUES (NULL, ?, ?, 'purchase', ?, ?)", [pid, qty, req.user.id, (req.body?.note || 'รับของเข้าคลัง').slice(0, 255)], conn)
    })
    res.status(201).json({ ok: true })
}))

// ข้อความไม่ว่าง ไม่ยาวเกินคอลัมน์ในฐานข้อมูล
const text = (v, field, max) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s) fail(400, `กรุณากรอก${field}`)
    if (s.length > max) fail(400, `${field}ยาวเกิน ${max} ตัวอักษร`)
    return s
}
// ตัวเลขทศนิยมในช่วงที่กำหนด (น้ำหนัก ราคา)
const decimal = (v, field, { min = 0, max, gt } = {}) => {
    const n = Number(v)
    if (v === '' || v === null || v === undefined || !Number.isFinite(n)) fail(400, `${field}ต้องเป็นตัวเลข`)
    if (gt !== undefined ? n <= gt : n < min) fail(400, `${field}ต้องมากกว่า ${gt ?? min}`)
    if (max !== undefined && n > max) fail(400, `${field}ต้องไม่เกิน ${max}`)
    return n
}

/**
 * Admin เพิ่มสินค้าใหม่ บันทึก 3 ที่ใน transaction เดียว (พังกลางทางจะไม่เหลือข้อมูลครึ่ง ๆ):
 * 1. product  2. warehouse_stock (จำนวนเริ่มต้นในคลัง)  3. branch_stock ของทุกสาขา (เริ่มที่ 0)
 * สาขาเริ่มที่ 0 ซึ่งต่ำกว่าจุดสั่ง ระบบจึงร่างคำขอ "ล็อตแรก" ให้ทุกสาขาทันที
 */
router.post('/products', authCheck, requireRole('admin'), handle(async (req, res) => {
    const b = req.body || {}
    const sku = text(b.sku, 'รหัสสินค้า', 10)
    if (!/^[A-Za-z0-9-]+$/.test(sku)) fail(400, 'รหัสสินค้าใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข และขีด (-)')
    const name = text(b.name, 'ชื่อสินค้า', 120)
    const category = text(b.category, 'หมวด', 50)
    const unit = text(b.unit, 'หน่วย', 20)
    const weightKg = decimal(b.weight_kg, 'น้ำหนักต่อหน่วย', { gt: 0, max: 99999 })
    const price = decimal(b.price, 'ราคา', { min: 0, max: 99999999 })
    const qty = posInt(b.qty ?? 0, 'จำนวนเริ่มต้นในคลัง', { allowZero: true })
    const whReorder = posInt(b.warehouse_reorder_point ?? 0, 'จุดสั่งของคลัง', { allowZero: true })
    const reorderPoint = posInt(b.reorder_point, 'จุดสั่งของสาขา', { allowZero: true })
    const maxQty = posInt(b.max_qty, 'จำนวนสูงสุดของสาขา')
    if (maxQty <= reorderPoint) fail(400, 'จำนวนสูงสุดต้องมากกว่าจุดสั่ง')

    const out = await transaction(async (conn) => {
        if (await one('SELECT id FROM product WHERE sku = ?', [sku], conn)) fail(409, `รหัสสินค้า ${sku} มีอยู่แล้ว`)
        const ins = await query(
            'INSERT INTO product (sku, name, category, unit, weight_kg, price, branch_reorder_point, branch_max_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [sku, name, category, unit, weightKg, price, reorderPoint, maxQty],
            conn
        )
        const pid = ins.insertId
        await query('INSERT INTO warehouse_stock (product_id, qty, reorder_point) VALUES (?, ?, ?)', [pid, qty, whReorder], conn)
        if (qty > 0) {
            await query("INSERT INTO stock_movement (branch_id, product_id, `change`, reason, user_id, note) VALUES (NULL, ?, ?, 'purchase', ?, 'สินค้าใหม่: สต็อกเริ่มต้น')", [pid, qty, req.user.id], conn)
        }
        // สาขาที่ปิดอยู่ก็ได้แถวสต็อกด้วย (เปิดกลับมาจะได้ครบ) แต่ร่างคำขอเฉพาะสาขาที่เปิด (checkLowStock ข้ามสาขาที่ปิด)
        const branches = await query('SELECT id FROM branch WHERE is_warehouse = 0', [], conn)
        if (branches.length) {
            await query('INSERT INTO branch_stock (branch_id, product_id, qty, reorder_point, max_qty) VALUES ?', [branches.map((br) => [br.id, pid, 0, reorderPoint, maxQty])], conn)
        }
        let drafted = 0
        for (const br of branches) if (await checkLowStock(conn, br.id, [pid], { launch: true })) drafted++
        return { id: pid, sku, branches: branches.length, drafted }
    })
    emit('ops', 'requests_changed', {})
    res.status(201).json(out)
}))

module.exports = router
