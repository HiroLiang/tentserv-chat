import { Navbar } from '@/components/layout/Navbar.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { LayoutDashboard, Users, MessageSquare, Activity } from 'lucide-react';

const statsPlaceholder = [
    { label: '總用戶數', icon: Users, value: '—' },
    { label: '活躍聊天室', icon: MessageSquare, value: '—' },
    { label: '今日訊息', icon: Activity, value: '—' },
];

export const AdminPage = () => {
    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <Navbar />
            <main className="flex-1 overflow-y-auto p-8">
                <div className="max-w-5xl mx-auto space-y-6">

                    <div className="flex items-center gap-3">
                        <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
                        <div>
                            <h1 className="text-2xl font-bold">後台管理</h1>
                            <p className="text-muted-foreground text-sm">系統概覽與管理功能</p>
                        </div>
                    </div>

                    {/* Stats overview */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        {statsPlaceholder.map(({ label, icon: Icon, value }) => (
                            <Card key={label}>
                                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                                    <CardTitle className="text-sm font-medium">{label}</CardTitle>
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <p className="text-2xl font-bold">{value}</p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/* Management sections placeholder */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">用戶管理</CardTitle>
                                <CardDescription>查看、停用或刪除帳號</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">即將推出</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">聊天室管理</CardTitle>
                                <CardDescription>監控聊天室狀態與內容</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">即將推出</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">系統公告</CardTitle>
                                <CardDescription>向所有用戶發送系統通知</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">即將推出</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">操作日誌</CardTitle>
                                <CardDescription>稽核後台操作記錄</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">即將推出</p>
                            </CardContent>
                        </Card>
                    </div>

                </div>
            </main>
        </div>
    );
};
