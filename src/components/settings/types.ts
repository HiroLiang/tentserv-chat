import type { LucideIcon } from 'lucide-react';
import type { User } from '@/types/user.ts';

export interface SettingsContext {
    user: User | null;
    // Extend later with feature flags such as hasChatIdentity or isVerified.
}

export interface SettingsSection {
    id: string;
    label: string;
    icon: LucideIcon;
    component: React.ComponentType;
    /** Show by default; return false to hide this section. */
    condition?: (ctx: SettingsContext) => boolean;
}

export interface SettingsGroup {
    title?: string;
    sections: SettingsSection[];
}
