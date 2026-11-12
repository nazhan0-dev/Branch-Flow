const { query } = require('../config/db')
const { emit } = require('./realtime')

// บันทึกแจ้งเตือนลงตาราง แล้วส่งแบบ real-time ไปยังห้องที่เกี่ยวข้อง
// target: { role: 'admin' } | { role: 'branch', branchId } | { userId, role: 'driver' }
const notify = async (target, type, message, link = null, conn) => {
    const row = {
        user_id: target.userId || null,
        role: target.role || null,
        branch_id: target.branchId || null,
        type,
        message,
        link,
    }
    const res = await query('INSERT INTO notification SET ?', [row], conn)
    const payload = { id: res.insertId, type, message, link, createdAt: new Date().toISOString() }

    if (target.userId && target.role === 'driver') emit(`driver:${target.userId}`, 'notification', payload)
    else if (target.role === 'branch') emit(`branch:${target.branchId}`, 'notification', payload)
    else if (target.role === 'admin') emit('admin', 'notification', payload)
    else if (target.role === 'executive') emit('exec', 'notification', payload)
}

module.exports = { notify }
