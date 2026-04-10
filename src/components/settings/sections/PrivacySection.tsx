import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const PrivacySection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Privacy & Security</h2>
                <p className="text-muted-foreground text-sm mt-1">Manage who can see your information and signed-in devices</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Profile Visibility</CardTitle>
                    <CardDescription>Control who can view your profile</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Signed-in Devices</CardTitle>
                    <CardDescription>Manage devices currently signed in to your account</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Blocked Users</CardTitle>
                    <CardDescription>Manage users you have blocked</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>
        </div>
    );
};
