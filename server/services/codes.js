// รหัสที่คนอ่านง่าย สร้างจาก id
const requestCode = (id) => `RQ-${2000 + id}`
const tripCode = (id) => `TR-${String(400 + id).padStart(4, '0')}`

module.exports = { requestCode, tripCode }
