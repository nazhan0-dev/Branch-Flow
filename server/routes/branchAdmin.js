const router = require('express').Router()
const bcrypt = require('bcryptjs')
const { query, one, transaction } = require('../config/db')
const { fail, handle, posInt } = require('../config/errors')
const { text, password, email, phone } = require('../config/validate')
const { authCheck, requireRole } = require('../middlewares/auth')
const { checkLowStock } = require('../services/replenish')
const { notify } = require('../services/notify')
const { emit } = require('../services/realtime')

// จัดการสาขาและบัญชีพนักงานสาขา: Admin เท่านั้น
// ปิดสาขาแทนการลบ (ประวัติคำขอ/ยอดขายเก่ายังอยู่) พนักงานของสาขาที่ปิดล็อกอินไม่ได้ทันที

// พิกัดต้องอยู่ในประเทศไทยคร่าว ๆ กันปักหมุดผิดทวีป (สลับ lat/lng)
const coord = (lat, lng) => {
    const a = Number(lat), b = Number(lng)
    if (!Number.isFinite(a) || !Number.isFinite(b)) fail(400, 'กรุณาปักหมุดตำแหน่งสาขาบนแผนที่')
    if (a < 5 || a > 21 || b < 97 || b > 106) fail(400, 'ตำแหน่งสาขาต้องอยู่ในประเทศไทย')
    return [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6]
}
const branchFields = (body, partial = false) => {
    const out = {}
    const has = (k) => !partial || k in body
    if (has('name')) out.name = text(body.name, 'ชื่อสาขา', 100)
    if (has('region')) out.region = text(body.region, 'ภาค', 50)
    if (has('address')) out.address = text(body.address, 'ที่อยู่', 255, { optional: true })
    if (has('lat') || has('lng')) [out.lat, out.lng] = coord(body.lat, body.lng)
    return out
}
const emailTaken = async (e, conn) => {
    if (await one('SELECT id FROM user WHERE email = ?', [e], conn)) fail(409, `อีเมล ${e} มีผู้ใช้แล้ว`)
}
const addStaff = async (conn, branchId, s) => {
    const e = email(s?.email)
    const n = text(s?.name, 'ชื่อพนักงาน', 100)
    const p = phone(s?.phone)
    const pw = password(s?.password)
    await emailTaken(e, conn)
    const ins = await query("INSERT INTO user (email, password, name, role, phone, branch_id) VALUES (?, ?, ?, 'branch', ?, ?)", [e, await bcrypt.hash(pw, 10), n, p, branchId], conn)
    return { id: ins.insertId, email: e }
}
const changed = (branchId) => {
    emit('ops', 'branches_changed', {})
    if (branchId) emit(`branch:${branchId}`, 'branches_changed', {})
}

// ข้อมูลสาขา + บัญชีพนักงาน (หน้าจัดการสาขา)
router.get('/admin/branches/:id', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    const b = await one('SELECT id, code, name, region, address, lat, lng, active, is_warehouse AS isWarehouse FROM branch WHERE id = ?', [id])
    if (!b || b.isWarehouse) fail(404, 'ไม่พบสาขา')
    const [users, open] = await Promise.all([
        query("SELECT id, name, email, phone, enabled, created_at AS createdAt FROM user WHERE role = 'branch' AND branch_id = ? ORDER BY enabled DESC, id", [id]),
        one(
            `SELECT SUM(status IN ('draft','pending')) AS waiting, SUM(status IN ('approved','in_transit')) AS shipping
             FROM replenish_request WHERE branch_id = ?`,
            [id]
        ),
    ])
    res.json({ ...b, active: !!b.active, users: users.map((u) => ({ ...u, enabled: !!u.enabled })), waiting: Number(open.waiting || 0), shipping: Number(open.shipping || 0) })
}))

// ภาคที่มีอยู่แล้ว (ให้เลือกในฟอร์ม ไม่ต้องพิมพ์ซ้ำ)
router.get('/admin/regions', authCheck, requireRole('admin'), handle(async (req, res) => {
    res.json((await query('SELECT DISTINCT region FROM branch WHERE is_warehouse = 0 ORDER BY region')).map((r) => r.region))
}))

/**
 * เพิ่มสาขาใหม่ (+ บัญชีพนักงานคนแรก ถ้าส่งมา)
 * สต็อกเริ่มต้น = 0 ทุกสินค้า จุดสั่งซื้อ/เพดานใช้ค่ามาตรฐานของสินค้า (ที่ตั้งตอนเพิ่มสินค้า) แล้วระบบร่างคำขอล็อตแรกให้ทันที
 */
router.post('/branches', authCheck, requireRole('admin'), handle(async (req, res) => {
    const body = req.body || {}
    const code = text(body.code, 'รหัสสาขา', 10).toUpperCase()
    if (!/^[A-Z0-9-]{2,10}$/.test(code)) fail(400, 'รหัสสาขาใช้ได้เฉพาะ A-Z, 0-9 และ - (2–10 ตัว)')
    const f = branchFields(body)

    const out = await transaction(async (conn) => {
        if (await one('SELECT id FROM branch WHERE code = ?', [code], conn)) fail(409, `รหัสสาขา ${code} มีอยู่แล้ว`)
        const ins = await query('INSERT INTO branch (code, name, region, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)', [code, f.name, f.region, f.address, f.lat, f.lng], conn)
        const id = ins.insertId
        const staff = body.staff ? await addStaff(conn, id, body.staff) : null
        const products = await query('SELECT id, branch_reorder_point AS rp, branch_max_qty AS mx FROM product', [], conn)
        if (products.length) {
            await query('INSERT INTO branch_stock (branch_id, product_id, qty, reorder_point, max_qty) VALUES ?', [products.map((p) => [id, p.id, 0, p.rp, Math.max(p.mx, p.rp + 1)])], conn)
        }
        const draft = products.length ? await checkLowStock(conn, id, products.map((p) => p.id), { launch: 'สาขาใหม่ ล็อตแรก' }) : null
        await notify({ role: 'admin' }, 'branch_opened', `เปิดสาขาใหม่ ${f.name} (${code})${draft ? ' · ร่างคำขอล็อตแรกแล้ว' : ''}`, `/admin/branches/${id}`, conn)
        return { id, code, staff, products: products.length, drafted: !!draft }
    })
    changed()
    emit('ops', 'requests_changed', {})
    res.status(201).json(out)
}))

/**
 * แก้ข้อมูลสาขา / ปิด-เปิดสาขา
 * ปิดสาขา: ห้ามถ้ามีของที่อนุมัติแล้วหรือกำลังส่งไป (ต้องยกเลิก/ส่งให้เสร็จก่อน)
 *          คำขอที่ยังไม่อนุมัติ (ร่าง/รออนุมัติ) ถูกยกเลิกให้อัตโนมัติ
 */
router.patch('/branches/:id', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    const body = req.body || {}
    await transaction(async (conn) => {
        const b = await one('SELECT id, name, active, is_warehouse FROM branch WHERE id = ? FOR UPDATE', [id], conn)
        if (!b || b.is_warehouse) fail(404, 'ไม่พบสาขา')
        const f = branchFields(body, true)
        if (Object.keys(f).length) {
            const cols = Object.keys(f)
            await query(`UPDATE branch SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => f[c]), id], conn)
        }
        if ('active' in body) {
            const active = body.active === true
            if (!active && b.active) {
                const busy = await one("SELECT COUNT(*) AS n FROM replenish_request WHERE branch_id = ? AND status IN ('approved','in_transit')", [id], conn)
                if (Number(busy.n)) fail(409, `${b.name} มีของที่อนุมัติแล้วหรือกำลังส่ง ${busy.n} คำขอ ส่งให้เสร็จหรือยกเลิกก่อนปิดสาขา`)
                await query("UPDATE replenish_request SET status = 'cancelled', note = 'สาขาปิด' WHERE branch_id = ? AND status IN ('draft','pending')", [id], conn)
            }
            await query('UPDATE branch SET active = ? WHERE id = ?', [active ? 1 : 0, id], conn)
        }
    })
    changed(id)
    emit('ops', 'requests_changed', {})
    res.json({ ok: true })
}))

// ---------- บัญชีพนักงานสาขา ----------

router.post('/branches/:id/users', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    const out = await transaction(async (conn) => {
        const b = await one('SELECT id, is_warehouse FROM branch WHERE id = ?', [id], conn)
        if (!b || b.is_warehouse) fail(404, 'ไม่พบสาขา')
        return addStaff(conn, id, req.body)
    })
    changed(id)
    res.status(201).json(out)
}))

const loadStaff = async (id, conn) => {
    const u = await one("SELECT id, name, branch_id FROM user WHERE id = ? AND role = 'branch' FOR UPDATE", [id], conn)
    if (!u) fail(404, 'ไม่พบบัญชีพนักงานสาขา')
    return u
}

// ปิด-เปิดบัญชีพนักงาน (ปิดแล้วล็อกอินไม่ได้ทันที session เดิมใช้ไม่ได้)
router.patch('/branch-users/:id', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    if (typeof req.body?.enabled !== 'boolean') fail(400, 'ระบุ enabled เป็น true/false')
    const u = await transaction(async (conn) => {
        const s = await loadStaff(id, conn)
        await query('UPDATE user SET enabled = ? WHERE id = ?', [req.body.enabled ? 1 : 0, id], conn)
        return s
    })
    changed(u.branch_id)
    res.json({ ok: true })
}))

// ตั้งรหัสผ่านใหม่ให้พนักงานที่ลืมรหัส (เครื่องที่ล็อกอินด้วยรหัสเก่าถูกออกจากระบบ)
router.post('/branch-users/:id/password', authCheck, requireRole('admin'), handle(async (req, res) => {
    const id = posInt(req.params.id, 'id')
    const pw = password(req.body?.password)
    await transaction(async (conn) => {
        await loadStaff(id, conn)
        await query('UPDATE user SET password = ?, password_changed = UNIX_TIMESTAMP() WHERE id = ?', [await bcrypt.hash(pw, 10), id], conn)
    })
    res.json({ ok: true })
}))

module.exports = router
