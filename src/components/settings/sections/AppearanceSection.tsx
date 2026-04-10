import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Separator } from '@/components/ui/separator.tsx';

export const AppearanceSection = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold">Appearance</h2>
                <p className="text-muted-foreground text-sm mt-1">Customize the app theme and display</p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Theme</CardTitle>
                    <CardDescription>Choose light, dark, or system</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Font Size</CardTitle>
                    <CardDescription>Adjust the chat font size</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">Coming soon</p>
                </CardContent>
            </Card>
        </div>
    );
};
