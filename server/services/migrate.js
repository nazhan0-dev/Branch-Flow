const { query, one } = require('../config/db')

/**
 * ปรับโครงสร้างฐานข้อมูลเดิมให้รองรับฟีเจอร์ใหม่ โดยไม่ต้องล้างข้อมูล (รันทุกครั้งที่เปิด server รันซ้ำได้)
 * - vehicle.status เพิ่ม 'retired' (เลิกใช้)
 * - user.default_vehicle_id = รถประจำของคนขับ
 * - replenish_request.status เพิ่ม 'cancelled' (ยกเลิก)
 * - branch.active = เปิด/ปิดสาขา
 * - product.branch_reorder_point / branch_max_qty = ค่ามาตรฐานของสาขา (เติมจากค่าเฉลี่ยของสาขาที่มีอยู่)
 * - user.password_changed = เวลาที่ตั้งรหัสใหม่ล่าสุด (unix วินาที) ใช้ยกเลิก session เก่า
 */
const migrate = async () => {
    const st = await one("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicle' AND COLUMN_NAME = 'status'")
    if (st && !String(st.t).includes('retired')) {
        await query("ALTER TABLE vehicle MODIFY status ENUM('available','in_use','maintenance','retired') NOT NULL DEFAULT 'available'")
        console.log('[migrate] vehicle.status + retired')
    }
    const rs = await one("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenish_request' AND COLUMN_NAME = 'status'")
    if (rs && !String(rs.t).includes('cancelled')) {
        await query("ALTER TABLE replenish_request MODIFY status ENUM('draft','pending','approved','in_transit','received','rejected','cancelled') NOT NULL")
        console.log('[migrate] replenish_request.status + cancelled')
    }
    const act = await one("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch' AND COLUMN_NAME = 'active'")
    if (!Number(act.n)) {
        await query('ALTER TABLE branch ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1')
        console.log('[migrate] branch.active')
    }
    const pd = await one("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND COLUMN_NAME = 'branch_max_qty'")
    if (!Number(pd.n)) {
        await query('ALTER TABLE product ADD COLUMN branch_reorder_point INT NOT NULL DEFAULT 10, ADD COLUMN branch_max_qty INT NOT NULL DEFAULT 50')
        await query(`UPDATE product p JOIN (SELECT product_id, ROUND(AVG(reorder_point)) AS rp, ROUND(AVG(max_qty)) AS mx FROM branch_stock GROUP BY product_id) a ON a.product_id = p.id
             SET p.branch_reorder_point = a.rp, p.branch_max_qty = GREATEST(a.mx, a.rp + 1)`)
        console.log('[migrate] product.branch_reorder_point / branch_max_qty')
    }
    const pc = await one("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'password_changed'")
    if (!Number(pc.n)) {
        await query('ALTER TABLE user ADD COLUMN password_changed INT UNSIGNED NULL')
        console.log('[migrate] user.password_changed')
    }
    const col = await one("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'default_vehicle_id'")
    if (!Number(col.n)) {
        await query('ALTER TABLE user ADD COLUMN default_vehicle_id INT NULL, ADD CONSTRAINT fk_user_vehicle FOREIGN KEY (default_vehicle_id) REFERENCES vehicle(id)')
        console.log('[migrate] user.default_vehicle_id')
    }
}

module.exports = { migrate }
