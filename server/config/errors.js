// error ที่ตั้งใจส่งกลับให้ผู้ใช้ (เช่น ข้อมูลไม่ถูกต้อง, ไม่มีสิทธิ์)
class HttpError extends Error {
    constructor(status, message, details) {
        super(message)
        this.status = status
        this.details = details
    }
}

const fail = (status, message, details) => {
    throw new HttpError(status, message, details)
}

// ห่อ handler แบบ async ให้ error ไปถึง error middleware
const handle = (fn) => async (req, res, next) => {
    try {
        await fn(req, res, next)
    } catch (err) {
        next(err)
    }
}

// แปลงค่าเป็นจำนวนเต็มบวก ไม่ผ่าน = 400
const posInt = (value, field, { allowZero = false } = {}) => {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0 || (!allowZero && n === 0)) {
        fail(400, `${field} ต้องเป็นจำนวนเต็ม${allowZero ? 'ที่ไม่ติดลบ' : 'บวก'}`)
    }
    return n
}

module.exports = { HttpError, fail, handle, posInt }
