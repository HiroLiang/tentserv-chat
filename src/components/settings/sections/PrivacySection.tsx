import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const PrivacySection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">隱私與安全</h2>
                <p className="text-muted-foreground text-sm mt-1">管理誰能看到您的資訊及登入裝置</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">個人資料可見性</CardTitle>
                    <CardDescription>控制誰可以查看您的個人資料</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">已登入裝置</CardTitle>
                    <CardDescription>管理目前已登入您帳號的裝置</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">封鎖名單</CardTitle>
                    <CardDescription>管理您已封鎖的用戶</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>
        </div>
    );
};
