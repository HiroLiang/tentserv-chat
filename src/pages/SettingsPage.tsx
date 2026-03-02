import { Navbar } from "@/components/layout/Navbar.tsx";

export const SettingsPage = () => {
    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <Navbar />
            <main className="flex-1 p-6">
                <h1 className="text-2xl font-bold mb-2">Setting</h1>
                <p className="text-muted-foreground">Coming soon</p>
            </main>
        </div>
    );
};
