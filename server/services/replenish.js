const { query, one, transaction } = require('../config/db')
const { notify } = require('./notify')
const { requestCode } = require('./codes')

const OPEN = ['draft', 'pending', 'approved', 'in_transit']
const AUTO_SUBMIT_MINUTES = Number(process.env.AUTO_SUBMIT_MINUTES || 120)

/**
 * ตรวจสินค้าที่ใกล้หมดของสาขา แล้วร่างคำขอเติมของให้อัตโนมัติ
 * เรียกหลังสต็อกสาขาลดลง (ขาย, ของเสีย, ปรับยอด) ภายใน transaction เดียวกัน
 *
 * กติกา
 *  - ใกล้หมด = qty <= reorder_point (reorder_point = 0 คือไม่ต้องแจ้ง)
 *  - สินค้าที่มีคำขอเปิดอยู่แล้ว (ร่าง/รออนุมัติ/อนุมัติ/กำลังส่ง) ไม่สร้างซ้ำ
 *    แต่ถ้าของหมด (qty <= 0) จะยกระดับคำขอเดิมเป็น "ด่วน"
 *  - จำนวนที่แนะนำ = max_qty − qty (ไม่มีของกำลังมา เพราะเช็กคำขอเปิดแล้ว)
 *  - รวมเข้าร่างเดิมของสาขาถ้ามี ไม่อย่างนั้นสร้างร่างใหม่
 */
const checkLowStock = async (conn, branchId, productIds) => {
    if (!productIds.length) return null

    const low = await query(
        `SELECT bs.product_id, bs.qty, bs.reorder_point, bs.max_qty, p.name, p.sku
         FROM branch_stock bs JOIN product p ON p.id = bs.product_id
         WHERE bs.branch_id = ? AND bs.product_id IN (?) AND bs.reorder_point > 0 AND bs.qty <= bs.reorder_point`,
        [branchId, productIds],
        conn
    )
    if (!low.length) return null

    const open = await query(
        `SELECT ri.product_id, r.id, r.status, r.priority, r.code
         FROM request_item ri JOIN replenish_request r ON r.id = ri.request_id
         WHERE r.branch_id = ? AND r.status IN (?) AND ri.product_id IN (?)`,
        [branchId, OPEN, low.map((l) => l.product_id)],
        conn
    )
    const openByProduct = new Map(open.map((o) => [o.product_id, o]))

    // ของหมดแต่มีคำขอเปิดอยู่ → ยกระดับเป็นด่วน (ถ้ายังไม่ออกจากคลัง)
    for (const item of low) {
        const o = openByProduct.get(item.product_id)
        if (o && item.qty <= 0 && o.priority === 'normal' && ['draft', 'pending', 'approved'].includes(o.status)) {
            await query("UPDATE replenish_request SET priority = 'urgent' WHERE id = ?", [o.id], conn)
            o.priority = 'urgent'
            await notify({ role: 'admin' }, 'stock_out', `${item.name} ${item.sku} หมดแล้ว · ${o.code} เปลี่ยนเป็นด่วน`, `/admin/requests/${o.id}`, conn)
        }
    }

    const toAdd = low
        .filter((l) => !openByProduct.has(l.product_id))
        .map((l) => ({ ...l, suggested: Math.max(l.max_qty - l.qty, 0) }))
        .filter((l) => l.suggested > 0)
    if (!toAdd.length) return null

    const urgent = toAdd.some((l) => l.qty <= 0)
    let draft = await one(
        "SELECT id, code, priority FROM replenish_request WHERE branch_id = ? AND status = 'draft' ORDER BY id DESC LIMIT 1 FOR UPDATE",
        [branchId],
        conn
    )
    if (!draft) {
        const res = await query(
            `INSERT INTO replenish_request (code, branch_id, source, status, priority, auto_submit_at)
             VALUES ('tmp', ?, 'auto', 'draft', ?, UTC_TIMESTAMP(3) + INTERVAL ? MINUTE)`,
            [branchId, urgent ? 'urgent' : 'normal', AUTO_SUBMIT_MINUTES],
            conn
        )
        draft = { id: res.insertId, code: requestCode(res.insertId) }
        await query('UPDATE replenish_request SET code = ? WHERE id = ?', [draft.code, draft.id], conn)
    } else if (urgent && draft.priority !== 'urgent') {
        await query("UPDATE replenish_request SET priority = 'urgent' WHERE id = ?", [draft.id], conn)
    }

    await query(
        'INSERT INTO request_item (request_id, product_id, qty_requested) VALUES ?',
        [toAdd.map((l) => [draft.id, l.product_id, l.suggested])],
        conn
    )

    const names = toAdd.map((l) => l.name).join(', ')
    await notify({ role: 'branch', branchId }, 'auto_draft', `ระบบร่างคำขอ ${draft.code}: ${names} · ยืนยันภายใน ${AUTO_SUBMIT_MINUTES} นาที`, `/branch/requests/${draft.id}`, conn)
    if (urgent) {
        const b = await one('SELECT name FROM branch WHERE id = ?', [branchId], conn)
        await notify({ role: 'admin' }, 'stock_out', `สาขา${b.name}: ${toAdd.filter((l) => l.qty <= 0).map((l) => l.name).join(', ')} หมดแล้ว`, `/admin/requests/${draft.id}`, conn)
    }
    return { requestId: draft.id, code: draft.code, added: toAdd.map((l) => ({ productId: l.product_id, qty: l.suggested })) }
}

// ร่างที่ไม่มีใครยืนยันจนเลยเวลา → ส่งเข้าคลังให้เอง ของจะได้ไม่ขาดเพราะพนักงานลืมกด
const submitDueDrafts = async () => {
    return transaction(async (conn) => {
        const due = await query(
            "SELECT id, code, branch_id FROM replenish_request WHERE status = 'draft' AND auto_submit_at <= UTC_TIMESTAMP(3) FOR UPDATE",
            [],
            conn
        )
        for (const r of due) {
            await query("UPDATE replenish_request SET status = 'pending', submitted_at = UTC_TIMESTAMP(3) WHERE id = ?", [r.id], conn)
            await notify({ role: 'admin' }, 'request_submitted', `${r.code} ถูกส่งอัตโนมัติ (สาขาไม่ได้ยืนยันในเวลา)`, `/admin/requests/${r.id}`, conn)
        }
        return due.length
    })
}

// ตัวสำรอง: สแกนทุกสาขาหาสินค้าที่ใกล้หมดแต่ยังไม่มีคำขอ (เช่น หลังเปลี่ยน reorder_point)
const scanAllBranches = async () => {
    const branches = await query('SELECT DISTINCT branch_id FROM branch_stock WHERE reorder_point > 0 AND qty <= reorder_point')
    let drafted = 0
    for (const { branch_id } of branches) {
        const ids = (await query('SELECT product_id FROM branch_stock WHERE branch_id = ? AND reorder_point > 0 AND qty <= reorder_point', [branch_id])).map((r) => r.product_id)
        const res = await transaction((conn) => checkLowStock(conn, branch_id, ids))
        if (res) drafted++
    }
    return drafted
}

module.exports = { OPEN, checkLowStock, submitDueDrafts, scanAllBranches }
