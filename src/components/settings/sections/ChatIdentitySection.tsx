import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const ChatIdentitySection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">聊天身份</h2>
                <p className="text-muted-foreground text-sm mt-1">管理您在聊天室中使用的身份與暱稱</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">聊天暱稱</CardTitle>
                    <CardDescription>設定您在聊天室中顯示的名稱（與帳號名稱不同）</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">聊天頭像</CardTitle>
                    <CardDescription>設定聊天室專用的頭像</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>
        </div>
    );
};
