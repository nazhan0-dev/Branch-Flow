const { query, one } = require('../config/db')

/**
 * ปรับโครงสร้างฐานข้อมูลเดิมให้รองรับฟีเจอร์ใหม่ โดยไม่ต้องล้างข้อมูล (รันทุกครั้งที่เปิด server รันซ้ำได้)
 * - vehicle.status เพิ่ม 'retired' (เลิกใช้)
 * - user.default_vehicle_id = รถประจำของคนขับ
 * - replenish_request.status เพิ่ม 'cancelled' (ยกเลิก)
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
    const col = await one("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'default_vehicle_id'")
    if (!Number(col.n)) {
        await query('ALTER TABLE user ADD COLUMN default_vehicle_id INT NULL, ADD CONSTRAINT fk_user_vehicle FOREIGN KEY (default_vehicle_id) REFERENCES vehicle(id)')
        console.log('[migrate] user.default_vehicle_id')
    }
}

module.exports = { migrate }
