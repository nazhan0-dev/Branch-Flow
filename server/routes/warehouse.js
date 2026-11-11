const router = require('express').Router()
const { query, one, transaction } = require('../config/db')
const { fail, handle, posInt } = require('../config/errors')
const { authCheck, requireRole } = require('../middlewares/auth')

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

module.exports = router
