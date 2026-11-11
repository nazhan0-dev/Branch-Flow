import { useCallback, useEffect, useState } from 'react'
import api, { errMsg } from '../api/client'

// โหลดข้อมูลจาก API พร้อมสถานะ loading/error และฟังก์ชันโหลดใหม่
export const useApi = (path, deps = []) => {
    const [data, setData] = useState(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)

    const reload = useCallback(async () => {
        if (!path) return
        try {
            const res = await api.get(path)
            setData(res.data)
            setError('')
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

    return { data, error, loading, reload, setData }
}
