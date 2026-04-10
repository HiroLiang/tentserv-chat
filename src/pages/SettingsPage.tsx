import { useState, useMemo } from 'react';
import { Navbar } from '@/components/layout/Navbar.tsx';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar.tsx';
import { useUserStore } from '@/stores/userStore.ts';
import { User, Bell, Palette, ShieldCheck, MessageCircleMore } from 'lucide-react';
import type { SettingsContext, SettingsGroup } from '@/components/settings/types.ts';
import { AccountSection } from '@/components/settings/sections/AccountSection.tsx';
import { NotificationsSection } from '@/components/settings/sections/NotificationsSection.tsx';
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection.tsx';
import { PrivacySection } from '@/components/settings/sections/PrivacySection.tsx';
import { ChatIdentitySection } from '@/components/settings/sections/ChatIdentitySection.tsx';

/**
 * Settings section groups definition.
 * Add new sections here — they appear in the sidebar automatically.
 * Use `condition` to control visibility based on user context.
 */
const SETTINGS_GROUPS: SettingsGroup[] = [
    {
        title: 'General',
        sections: [
            {
                id: 'account',
                label: 'Account',
                icon: User,
                component: AccountSection,
            },
            {
                id: 'notifications',
                label: 'Notifications',
                icon: Bell,
                component: NotificationsSection,
            },
            {
                id: 'appearance',
                label: 'Appearance',
                icon: Palette,
                component: AppearanceSection,
            },
            {
                id: 'privacy',
                label: 'Privacy & Security',
                icon: ShieldCheck,
                component: PrivacySection,
            },
        ],
    },
    {
        title: 'Chat',
        sections: [
            {
                id: 'chat-identity',
                label: 'Chat Identity',
                icon: MessageCircleMore,
                component: ChatIdentitySection,
                // Show this only when the user has a chat identity feature.
                // condition: (ctx) => ctx.user?.hasChatIdentity === true,
            },
        ],
    },
];

export const SettingsPage = () => {
    const currentUser = useUserStore((state) => state.currentUser);

    const ctx: SettingsContext = useMemo(() => ({
        user: currentUser,
    }), [currentUser]);

    // Filter groups and sections based on condition
    const visibleGroups = useMemo(() => {
        return SETTINGS_GROUPS
            .map((group) => ({
                ...group,
                sections: group.sections.filter(
                    (s) => s.condition == null || s.condition(ctx)
                ),
            }))
            .filter((group) => group.sections.length > 0);
    }, [ctx]);

    const firstSectionId = visibleGroups[0]?.sections[0]?.id ?? '';
    const [selectedId, setSelectedId] = useState(firstSectionId);

    // Find the active section component
    const activeSection = useMemo(() => {
        for (const group of visibleGroups) {
            const found = group.sections.find((s) => s.id === selectedId);
            if (found) return found;
        }
        return visibleGroups[0]?.sections[0] ?? null;
    }, [selectedId, visibleGroups]);

    const ActiveComponent = activeSection?.component ?? null;

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <Navbar/>
            <div className="flex flex-1 overflow-hidden">
                <SettingsSidebar
                    groups={visibleGroups}
                    selected={selectedId}
                    onSelect={setSelectedId}
                />
                <main className="w-full flex-1 overflow-y-auto p-8 ">
                    {ActiveComponent && <ActiveComponent/>}
                </main>
            </div>
        </div>
    );
};
