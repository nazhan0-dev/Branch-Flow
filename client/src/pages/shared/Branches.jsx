import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useApi } from '../../lib/useApi'
import { useSocket } from '../../lib/socket'
import { baht, num } from '../../lib/format'
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SearchInput, Table, Tabs } from '../../components/ui'
import BranchDashboard from '../branch/Dashboard'

const FILTERS = [
    ['all', 'ทั้งหมด'],
    ['out', 'มีของหมด'],
    ['low', 'ใกล้หมด'],
    ['open', 'มีคำขอเปิดอยู่'],
]

/**
 * Admin / ผู้บริหาร: รายชื่อสาขาพร้อมตัวเลขสรุป กดเพื่อเปิด Dashboard ของสาขานั้น (ดูอย่างเดียว)
 * /admin/branches/:id และ /exec/branches/:id ใช้ component เดียวกับหน้าแรกของพนักงานสาขา
 */
export default function Branches({ viewer }) {
    const { id } = useParams()
    if (id) return <BranchDashboard key={id} branchId={Number(id)} viewer={viewer} />
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

    const rows = useMemo(() => {
        const ql = q.trim().toLowerCase()
        return (data || []).filter((b) => {
            const ok = filter === 'all' || (filter === 'out' && b.outItems > 0) || (filter === 'low' && b.lowItems > 0) || (filter === 'open' && b.openRequests > 0)
            return ok && (!ql || `${b.name} ${b.code} ${b.region}`.toLowerCase().includes(ql))
        })
    }, [data, q, filter])

    if (loading && !data) return <Loading />
    if (error) return <ErrorBox>{error}</ErrorBox>
    const totalToday = data.reduce((s, b) => s + Number(b.salesToday), 0)
    const total7d = data.reduce((s, b) => s + Number(b.sales7d), 0)
    const waste7d = data.reduce((s, b) => s + Number(b.waste7d), 0)

    return (
        <>
            <PageHeader title="สาขา" sub={`${data.length} สาขา · ยอดขายวันนี้รวม ${baht(totalToday)} · 7 วัน ${baht(total7d)} · ของเสีย 7 วัน ${baht(waste7d)}`} />
            <div className="flex flex-wrap items-center gap-2.5">
                <SearchInput value={q} onChange={setQ} placeholder="ค้นหาชื่อสาขา รหัส หรือภาค" className="min-w-[220px] flex-1" />
                <Tabs items={FILTERS} value={filter} onChange={setFilter} />
            </div>
            <Card>
                <Table head={['สาขา', 'ภาค', { label: 'ยอดขายวันนี้', right: true }, { label: 'ยอดขาย 7 วัน', right: true }, { label: 'ของเสีย 7 วัน', right: true }, 'สต็อก', 'คำขอเปิดอยู่', '']} minWidth={860}>
                    {rows.map((b) => (
                        <tr key={b.id} onClick={() => navigate(`${base}/branches/${b.id}`)} className="cursor-pointer hover:bg-soft">
                            <td><b className="font-semibold">{b.name}</b> <span className="text-muted">{b.code}</span></td>
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
                {rows.length === 0 && <Empty>ไม่พบสาขาที่ตรงกับเงื่อนไข</Empty>}
            </Card>
        </>
    )
}
