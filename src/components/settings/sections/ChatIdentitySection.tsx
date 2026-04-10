import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const ChatIdentitySection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Chat Identity</h2>
                <p className="text-muted-foreground text-sm mt-1">Manage the identity and nickname you use in chat</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Chat Nickname</CardTitle>
                    <CardDescription>Set the name shown in chat</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Chat Avatar</CardTitle>
                    <CardDescription>Set a chat-specific avatar</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>
        </div>
    );
};
