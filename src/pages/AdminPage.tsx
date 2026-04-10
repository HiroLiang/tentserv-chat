import { Navbar } from '@/components/layout/Navbar.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { LayoutDashboard, Users, MessageSquare, Activity } from 'lucide-react';

const statsPlaceholder = [
    { label: 'Total Users', icon: Users, value: '—' },
    { label: 'Active Chat Rooms', icon: MessageSquare, value: '—' },
    { label: 'Messages Today', icon: Activity, value: '—' },
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
                            <h1 className="text-2xl font-bold">Admin Console</h1>
                            <p className="text-muted-foreground text-sm">System overview and management</p>
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
                                <CardTitle className="text-base">User Management</CardTitle>
                                <CardDescription>View, deactivate, or delete accounts</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">Coming soon</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Chat Room Management</CardTitle>
                                <CardDescription>Monitor chat room status and content</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">Coming soon</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">System Announcements</CardTitle>
                                <CardDescription>Send system notifications to all users</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">Coming soon</p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Audit Logs</CardTitle>
                                <CardDescription>Review admin action logs</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm text-muted-foreground">Coming soon</p>
                            </CardContent>
                        </Card>
                    </div>

                </div>
            </main>
        </div>
    );
};
