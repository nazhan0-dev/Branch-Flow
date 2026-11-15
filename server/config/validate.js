const { fail } = require('./errors')

// ตรวจข้อมูลจากฟอร์มที่ใช้ร่วมกันหลาย route (สินค้า, รถ/คนขับ, สาขา) ไม่ผ่าน = 400 พร้อมข้อความภาษาไทย

// ข้อความ: ตัดช่องว่างหัวท้าย, ไม่ยาวเกินคอลัมน์ในฐานข้อมูล · optional = เว้นว่างได้ (คืน null)
const text = (v, field, max, { min = 1, optional = false } = {}) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s && optional) return null
    if (s.length < min) fail(400, min > 1 ? `${field}ต้องมีอย่างน้อย ${min} ตัวอักษร` : `กรุณากรอก${field}`)
    if (s.length > max) fail(400, `${field}ยาวเกิน ${max} ตัวอักษร`)
    return s
}

// ตัวเลขทศนิยมในช่วงที่กำหนด (น้ำหนัก ราคา) · gt = ต้องมากกว่า (ไม่รวมค่านั้น)
const decimal = (v, field, { min = 0, max, gt } = {}) => {
    const n = Number(v)
    if (v === '' || v === null || v === undefined || !Number.isFinite(n)) fail(400, `${field}ต้องเป็นตัวเลข`)
    if (gt !== undefined ? n <= gt : n < min) fail(400, `${field}ต้องมากกว่า ${gt ?? min}`)
    if (max !== undefined && n > max) fail(400, `${field}ต้องไม่เกิน ${max}`)
    return n
}

// รหัสผ่าน 8–72 ตัว (bcrypt ใช้ได้แค่ 72 ไบต์แรก)
const password = (v) => {
    const s = typeof v === 'string' ? v : ''
    if (s.length < 8) fail(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
    if (s.length > 72) fail(400, 'รหัสผ่านยาวเกิน 72 ตัวอักษร')
    return s
}

// อีเมลเก็บเป็นตัวเล็กเสมอ (ล็อกอินไม่สนตัวพิมพ์เล็ก/ใหญ่)
const email = (v) => {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 120) fail(400, 'รูปแบบอีเมลไม่ถูกต้อง')
    return s
}

// เบอร์โทร (ไม่บังคับ) ตัวเลข + - เว้นวรรค 9–20 ตัว
const phone = (v) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s) return null
    if (!/^[0-9+\-\s]{9,20}$/.test(s)) fail(400, 'เบอร์โทรไม่ถูกต้อง')
    return s
}

module.exports = { text, decimal, password, email, phone }
