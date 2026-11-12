// ห้อง (room) ของ Socket.io แยกตามสิทธิ์
//   ops            = admin + ผู้บริหาร (ข้อมูลอัปเดตทุกอย่าง: รถ, คำขอ, สต็อก)
//   admin / exec   = แจ้งเตือนแยกกัน: คลังได้แจ้งเตือนงานรายเคส ผู้บริหารได้เฉพาะสรุปผล
//   branch:<id>    = พนักงานสาขานั้น
//   driver:<id>    = คนขับคนนั้น
// สาขาจึงไม่ได้รับพิกัดของรถที่ไม่ได้มาสาขาตัวเอง
let io = null

const setIO = (server) => {
    io = server
}

const roomsFor = (user) => {
    if (user.role === 'admin') return ['ops', 'admin']
    if (user.role === 'executive') return ['ops', 'exec']
    if (user.role === 'branch') return [`branch:${user.branchId}`]
    if (user.role === 'driver') return [`driver:${user.id}`]
    return []
}

const emit = (rooms, event, payload) => {
    if (!io) return
    const list = Array.isArray(rooms) ? rooms : [rooms]
    let target = io
    for (const r of list) target = target.to(r)
    target.emit(event, payload)
}

module.exports = { setIO, roomsFor, emit }
