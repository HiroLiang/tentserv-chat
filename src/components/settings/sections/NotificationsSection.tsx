import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const NotificationsSection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Notifications</h2>
                <p className="text-muted-foreground text-sm mt-1">Control how often you receive notifications</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Message Notifications</CardTitle>
                    <CardDescription>New messages, mentions, and replies</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">System Notifications</CardTitle>
                    <CardDescription>Account activity and security alerts</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>
        </div>
    );
};
