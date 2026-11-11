const jwt = require('jsonwebtoken')
const { one } = require('../config/db')
const { fail, handle } = require('../config/errors')

const COOKIE = 'token'
const MAX_AGE_MS = 12 * 60 * 60 * 1000 // 12 ชั่วโมง = หนึ่งกะงาน

// lax  = หน้าเว็บกับ API อยู่ site เดียวกัน (เช่น localhost:5173 กับ localhost:8000 หรือ app.x.com กับ api.x.com)
// none = หน้าเว็บกับ API อยู่คนละโดเมน เบราว์เซอร์บังคับว่าต้องเป็น secure (HTTPS) ด้วย
const SAME_SITE = ['lax', 'strict', 'none']
const sameSite = () => {
    const v = (process.env.COOKIE_SAMESITE || 'lax').trim().toLowerCase()
    if (!SAME_SITE.includes(v)) throw new Error(`COOKIE_SAMESITE ต้องเป็น ${SAME_SITE.join(' / ')} (ได้ "${v}")`)
    return v
}

const cookieOptions = () => {
    const ss = sameSite()
    return {
        httpOnly: true, // JavaScript บนหน้าเว็บอ่านไม่ได้ กัน token ถูกขโมยผ่าน XSS
        sameSite: ss,
        secure: ss === 'none' || process.env.NODE_ENV === 'production',
        maxAge: MAX_AGE_MS,
        path: '/',
    }
}

const sign = (user) => jwt.sign({ id: user.id }, process.env.SECRET, { expiresIn: MAX_AGE_MS / 1000 })

// อ่าน token → โหลดผู้ใช้จากฐานข้อมูลทุกครั้ง (บัญชีที่ถูกระงับใช้ไม่ได้ทันที)
const loadUser = async (token) => {
    if (!token) return null
    try {
        const { id } = jwt.verify(token, process.env.SECRET)
        return await one(
            'SELECT id, email, name, role, branch_id AS branchId FROM user WHERE id = ? AND enabled = 1',
            [id]
        )
    } catch {
        return null
    }
}

const authCheck = handle(async (req, res, next) => {
    const user = await loadUser(req.cookies?.[COOKIE])
    if (!user) fail(401, 'กรุณาเข้าสู่ระบบ')
    req.user = user
    next()
})

const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return next(Object.assign(new Error('ไม่มีสิทธิ์ใช้งานส่วนนี้'), { status: 403 }))
    next()
}

// สาขาเห็น/แก้ได้เฉพาะสาขาตัวเอง admin และผู้บริหารเห็นทุกสาขา
const assertBranchAccess = (user, branchId) => {
    if (user.role === 'admin' || user.role === 'executive') return
    if (user.role === 'branch' && user.branchId === Number(branchId)) return
    fail(403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลสาขานี้')
}

module.exports = { COOKIE, cookieOptions, sign, loadUser, authCheck, requireRole, assertBranchAccess }
