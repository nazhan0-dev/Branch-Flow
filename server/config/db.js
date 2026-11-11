const mysql = require('mysql2/promise')

// เวลาในฐานข้อมูลเป็น UTC ทั้งหมด หน้าเว็บแปลงเป็นเวลาไทยเอง
const pool = mysql.createPool({
    uri: process.env.DATABASE_URL || 'mysql://root@localhost:3306/branch_logistics',
    timezone: 'Z',
    dateStrings: false,
    connectionLimit: 10,
    decimalNumbers: true,
})

pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'")
})

// conn ส่งมาเมื่ออยู่ใน transaction ไม่ส่ง = ใช้ pool
const query = async (sql, params = [], conn = pool) => {
    const [rows] = await conn.query(sql, params)
    return rows
}

const one = async (sql, params = [], conn = pool) => {
    const rows = await query(sql, params, conn)
    return rows[0] || null
}

// รันหลายคำสั่งเป็นก้อนเดียว: ถ้ามี error ระหว่างทาง ทุกอย่างถูกยกเลิก
const transaction = async (fn) => {
    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()
        const result = await fn(conn)
        await conn.commit()
        return result
    } catch (err) {
        await conn.rollback()
        throw err
    } finally {
        conn.release()
    }
}

module.exports = { pool, query, one, transaction }
