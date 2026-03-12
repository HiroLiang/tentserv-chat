import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const NotificationsSection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">通知</h2>
                <p className="text-muted-foreground text-sm mt-1">控制您接收通知的方式與頻率</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">訊息通知</CardTitle>
                    <CardDescription>新訊息、提及與回覆的通知設定</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">系統通知</CardTitle>
                    <CardDescription>帳號活動與安全警示</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>
        </div>
    );
};
