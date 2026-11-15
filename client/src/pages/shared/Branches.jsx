import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { baht, num } from '../../lib/format'
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SearchInput, Table, Tabs } from '../../components/ui'
import BranchDashboard from '../branch/Dashboard'
import { AddBranchButton, BranchManage } from '../admin/BranchAdmin'

const FILTERS = [
    ['all', 'ทั้งหมด'],
    ['out', 'มีของหมด'],
    ['low', 'ใกล้หมด'],
    ['open', 'มีคำขอเปิดอยู่'],
]
const CLOSED = ['closed', 'ปิดแล้ว']

/**
 * Admin / ผู้บริหาร: รายชื่อสาขาพร้อมตัวเลขสรุป กดเพื่อเปิด Dashboard ของสาขานั้น
 * /admin/branches/:id และ /exec/branches/:id ใช้ component เดียวกับหน้าแรกของพนักงานสาขา
 * Admin มีปุ่มเพิ่มสาขา และการ์ดจัดการสาขา (แก้ข้อมูล, ปิด/เปิด, บัญชีพนักงาน)
 */
export default function Branches({ viewer }) {
    const { id } = useParams()
    if (id) return <BranchDashboard key={id} branchId={Number(id)} viewer={viewer} manage={viewer === 'admin' && <BranchManage branchId={Number(id)} />} />
    return <BranchList viewer={viewer} />
}

function BranchList({ viewer }) {
    const navigate = useNavigate()
    const base = viewer === 'executive' ? '/exec' : '/admin'
    const { data, error, loading, reload } = useApi('/dashboard/branches')
    const [q, setQ] = useState('')
    const [filter, setFilter] = useState('all')
    const refresh = useCallback(() => reload(), [reload])
    useSocket('stock_changed', refresh)
    useSocket('requests_changed', refresh)
    useSocket('branches_changed', refresh)
    const isAdmin = viewer === 'admin'

    const rows = useMemo(() => {
        const ql = q.trim().toLowerCase()
        return (data || []).filter((b) => {
            // สาขาที่ปิดแล้วแสดงเฉพาะแท็บ "ปิดแล้ว" (ทั้งหมดก็แสดง แต่อยู่ท้ายตาราง)
            if (filter === 'closed') return !b.active && (!ql || `${b.name} ${b.code} ${b.region}`.toLowerCase().includes(ql))
            if (!b.active && filter !== 'all') return false
            const ok = filter === 'all' || (filter === 'out' && b.outItems > 0) || (filter === 'low' && b.lowItems > 0) || (filter === 'open' && b.openRequests > 0)
            return ok && (!ql || `${b.name} ${b.code} ${b.region}`.toLowerCase().includes(ql))
        })
    }, [data, q, filter])

    if (loading && !data) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>
    const open = data.filter((b) => b.active)
    const closed = data.length - open.length
    const totalToday = data.reduce((s, b) => s + Number(b.salesToday), 0)
    const total7d = data.reduce((s, b) => s + Number(b.sales7d), 0)
    const waste7d = data.reduce((s, b) => s + Number(b.waste7d), 0)

    return (
        <>
            <PageHeader
                title="สาขา"
                sub={`${open.length} สาขา${closed ? ` (ปิดแล้ว ${closed})` : ''} · ยอดขายวันนี้รวม ${baht(totalToday)} · 7 วัน ${baht(total7d)} · ของเสีย 7 วัน ${baht(waste7d)}`}
                actions={isAdmin && <AddBranchButton onDone={refresh} />}
            />
            <div className="flex flex-wrap items-center gap-2.5">
                <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อสาขา รหัส หรือภาค" className="min-w-[220px] flex-1" />
                <Tabs items={closed ? [...FILTERS, CLOSED] : FILTERS} value={filter} onChange={setFilter} />
            </div>
            <Card>
                <Table head={['สาขา', 'ภาค', { label: 'ยอดขายวันนี้', right: true }, { label: 'ยอดขาย 7 วัน', right: true }, { label: 'ของเสีย 7 วัน', right: true }, 'สต็อก', 'คำขอเปิดอยู่', '']} minWidth={860}>
                    {rows.map((b) => (
                        <tr key={b.id} onClick={() => navigate(`${base}/branches/${b.id}`)} className={`cursor-pointer hover:bg-soft ${b.active ? '' : 'text-faint'}`}>
                            <td><b className="font-semibold">{b.name}</b> <span className="text-muted">{b.code}</span>{!b.active && <Badge className="ml-2">ปิดแล้ว</Badge>}</td>
                            <td className="text-muted">{b.region}</td>
                            <td className="text-right font-semibold">{baht(b.salesToday)}</td>
                            <td className="text-right">{baht(b.sales7d)}</td>
                            <td className="text-right">
                                {Number(b.waste7d) > 0 ? baht(b.waste7d) : <span className="text-faint">–</span>}
                                {Number(b.sales7d) > 0 && Number(b.waste7d) > 0 && <div className="text-xs text-muted">{((100 * b.waste7d) / b.sales7d).toFixed(1)}% ของยอดขาย</div>}
                            </td>
                            <td>
                                <div className="flex flex-wrap gap-1.5">
                                    {b.outItems > 0 && <Badge tone="danger">หมด {num(b.outItems)}</Badge>}
                                    {b.lowItems > 0 && <Badge tone="warn">ใกล้หมด {num(b.lowItems)}</Badge>}
                                    {!b.outItems && !b.lowItems && <Badge tone="brand">ปกติ</Badge>}
                                </div>
                            </td>
                            <td>
                                {b.openRequests > 0 ? (
                                    <span className="flex items-center gap-1.5">{num(b.openRequests)} {b.urgentRequests > 0 && <Badge tone="danger">ด่วน {num(b.urgentRequests)}</Badge>}</span>
                                ) : (
                                    <span className="text-faint">–</span>
                                )}
                            </td>
                            <td className="text-right text-muted"><ChevronRight size={16} className="inline" /></td>
                        </tr>
                    ))}
                </Table>
                {rows.length === 0 && <Empty>{data.length === 0 ? (isAdmin ? 'ยังไม่มีสาขา กด + เพิ่มสาขา' : 'ยังไม่มีสาขา') : 'ไม่พบสาขาที่ตรงกับเงื่อนไข'}</Empty>}
            </Card>
        </>
    )
}
