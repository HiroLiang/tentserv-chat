import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const AppearanceSection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">外觀</h2>
                <p className="text-muted-foreground text-sm mt-1">自訂介面的主題與顯示方式</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">主題</CardTitle>
                    <CardDescription>選擇淺色、深色或跟隨系統設定</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">字體大小</CardTitle>
                    <CardDescription>調整聊天介面的字體大小</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">即將推出</p>
                </CardContent>
            </Card>
        </div>
    );
};
