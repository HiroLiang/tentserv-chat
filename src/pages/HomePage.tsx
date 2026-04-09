import { Navbar } from "@/components/layout/Navbar.tsx";

export const HomePage = () => {
    return (
        <div className="flex min-h-screen flex-col">
            <Navbar/>
            <div className="flex-1" />
        </div>
    );
};
