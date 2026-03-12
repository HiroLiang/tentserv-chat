import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const AccountSection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">帳號</h2>
                <p className="text-muted-foreground text-sm mt-1">管理您的帳號資訊與安全設定</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">個人資料</CardTitle>
                    <CardDescription>更新您的顯示名稱與電子郵件</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">密碼</CardTitle>
                    <CardDescription>變更您的登入密碼</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">刪除帳號</CardTitle>
                    <CardDescription>永久刪除您的帳號與所有資料</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>
        </div>
    );
};
