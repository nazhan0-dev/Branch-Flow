import { useCallback, useEffect, useState } from 'react'
import api, { errMsg } from '../api/client'

// โหลดข้อมูลจาก API พร้อมสถานะ loading/error และฟังก์ชันโหลดใหม่
// updatedAt = เวลาที่โหลดข้อมูลสำเร็จล่าสุด (ใช้แสดง "อัปเดตล่าสุด")
// opts.poll = โหลดใหม่เองทุกกี่ ms (เฉพาะตอนแท็บเปิดอยู่) สำหรับข้อมูลที่ไม่มี socket แจ้งเมื่อเปลี่ยน
export const useApi = (path, deps = [], opts = {}) => {
    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [updatedAt, setUpdatedAt] = useState(null)

    const reload = useCallback(async () => {
        if (!path) return
        try {
            const res = await api.get(path)
            setData(res.data)
            setError('')
            setUpdatedAt(new Date())
        } catch (err) {
            setError(errMsg(err))
        } finally {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, ...deps])

    useEffect(() => {
        setLoading(true)
        reload()
    }, [reload])

    const poll = opts.poll
    useEffect(() => {
        if (!poll) return
        const t = setInterval(() => document.visibilityState === 'visible' && reload(), poll)
        // กลับมาที่แท็บ → โหลดใหม่ทันที ไม่ต้องรอรอบถัดไป
        const onVisible = () => document.visibilityState === 'visible' && reload()
        document.addEventListener('visibilitychange', onVisible)
        return () => {
            clearInterval(t)
            document.removeEventListener('visibilitychange', onVisible)
        }
    }, [poll, reload])

    return { data, error, loading, reload, setData, updatedAt }
}
